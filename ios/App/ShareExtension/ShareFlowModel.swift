//
//  ShareFlowModel.swift
//  Cinechrony Share Extension (Phase C.3 — Corner-style in-place drawer)
//
//  Drives the whole drawer state machine: submit the shared URL → poll the
//  extraction job (narrated stages) → let the user pick a destination + which
//  films to keep → save. Talks to the backend ONLY through ExtensionAPI (never
//  opens the host app on the happy path — see ShareViewController.onOpenApp,
//  which is the ONLY app-open path, reached solely from the signed-out/error
//  states).
//
//  @MainActor because every `@Published` mutation must land on the main
//  thread for SwiftUI to pick it up safely; the `await`s below hop to the
//  ExtensionAPI actor and back automatically.
//

import Foundation
import Combine
import UIKit

@MainActor
final class ShareFlowModel: ObservableObject {

    enum Phase: Equatable {
        case working(stage: String, thumbnail: String?)
        case signedOut
        case error(message: String)
        /// The weekly free-scan quota is spent (server `QUOTA_EXCEEDED`).
        /// Distinct from `.error`: it renders INLINE with no retry / open-app
        /// button — retrying would just fail again, and this is a product
        /// limit, not a broken share, so it must never bounce the user out to
        /// the host app.
        case quotaExceeded
        case ready
        case done(listName: String)
    }

    enum Destination: Equatable {
        case newList
        case existing(id: String, ownerId: String, name: String)
    }

    // MARK: - Published state

    @Published private(set) var phase: Phase
    @Published private(set) var films: [ExtractionFilmDTO] = []
    /// The reveal choreography: rows land one by one (spring + haptic per
    /// film) and the header counts up with them — the payoff moment after
    /// the wait. The view renders `films.prefix(revealedCount)`.
    @Published private(set) var revealedCount = 0
    @Published var included: Set<Int> = []
    @Published var destination: Destination = .newList
    @Published var newListName: String = "new films"
    @Published var isSaving = false
    @Published var saveErrorMessage: String?
    @Published var showPicker = false
    @Published var lists: [PickerListItem] = []
    @Published var isLoadingLists = false
    /// MN01 — Rodeo-style scan → save → plan continuity: whether the "plan a
    /// movie night" secondary action can render on the done state. Flips true
    /// only once `saveSucceeded` has captured a REAL destination list id —
    /// never invented client-side, so a save that somehow reported no real
    /// listId (shouldn't happen; `save()` already bails on zero successes)
    /// just leaves the button off.
    @Published private(set) var canPlanNight = false

    /// Same labels as the web client's STAGE_LABEL (src/app/extract/client.tsx)
    /// so the copy matches whichever surface the user happens to see.
    let stageLabels: [String: String] = [
        "queued": "getting ready",
        "fetching": "getting the video",
        "watching": "watching it",
        "matching": "matching films",
        "done": "done",
        "failed": "failed",
    ]

    /// Set by ShareViewController: complete the extension request (idempotent there).
    var onFinish: (() -> Void)?
    /// Set by ShareViewController: the ONLY app-open path (signed-out / error states).
    var onOpenApp: ((URL) -> Void)?
    /// Set by ShareViewController: opens an ALREADY-BUILT deep link (the
    /// `cinechrony://plan-night?…` URL from `planNightDeepLink()`) via the
    /// same responder-chain mechanism as `onOpenApp` — see `planMovieNight()`.
    var onPlanNight: ((URL) -> Void)?

    // MARK: - Private

    private let sharedURL: URL
    private let api = ExtensionAPI()
    private var jobId: String?
    private var pollAttempt = 0
    private var submittedAt = Date()
    private var runTask: Task<Void, Never>?
    private var revealTask: Task<Void, Never>?
    private var autoCloseTask: Task<Void, Never>?
    /// The REAL destination list identity, captured off the save response —
    /// `savedListId` only becomes non-nil once the server actually created
    /// (or confirmed) the list; a brand-new list has no id before that.
    /// `savedFilm` is set only when exactly one film was saved (mirrors the
    /// web client's SavedState prefill rule in src/app/extract/client.tsx).
    private var savedListId: String?
    private var savedListOwnerId: String?
    private var savedFilm: ExtractionFilmDTO?

    init(sharedURL: URL) {
        self.sharedURL = sharedURL
        self.phase = .working(stage: "queued", thumbnail: nil)
    }

    // MARK: - Lifecycle

    func start() {
        runTask?.cancel()
        runTask = Task { [weak self] in await self?.run() }
    }

    /// Re-run from submit — used by the error state's "try again" (createExtraction
    /// cache-hits on the server if the same URL already produced a job, so this
    /// is cheap even though it looks like "starting over").
    func retry() {
        phase = .working(stage: "queued", thumbnail: nil)
        start()
    }

    /// X close, at any point. The job (if any) keeps running server-side and
    /// the completion push is the safety net — no extra UI needed here.
    ///
    /// Closing MID-SCAN additionally tells the server this live surface is
    /// gone (detach): our own polling stamps `lastPolledAt`, and a pipeline
    /// finishing within the live-watcher window after the close would
    /// otherwise suppress the very push the user walked away expecting. The
    /// short bounded delay gives the request time to leave the process before
    /// the extension is torn down; the non-scanning paths close instantly.
    func close() {
        runTask?.cancel()
        revealTask?.cancel()
        autoCloseTask?.cancel()
        if let jobId, case .working = phase {
            let api = self.api
            Task { [onFinish] in
                let detachTask = Task { await api.detach(jobId: jobId) }
                try? await Task.sleep(nanoseconds: 600_000_000)
                detachTask.cancel()
                onFinish?()
            }
        } else {
            onFinish?()
        }
    }

    private func run() async {
        guard await api.loadCredential() else {
            phase = .signedOut
            return
        }
        await submit()
    }

    private func submit() async {
        phase = .working(stage: "queued", thumbnail: nil)
        submittedAt = Date()
        do {
            let created = try await api.createExtraction(url: sharedURL.absoluteString)
            guard !Task.isCancelled else { return }
            jobId = created.jobId
            if created.status == "done" {
                let job = try await api.getExtraction(jobId: created.jobId)
                finalize(job)
            } else {
                pollAttempt = 0
                await poll(jobId: created.jobId)
            }
        } catch {
            guard !Task.isCancelled else { return }
            await handle(error: error)
        }
    }

    private func poll(jobId: String) async {
        while !Task.isCancelled {
            if Date().timeIntervalSince(submittedAt) > 180 {
                phase = .error(message: "it might be private or unavailable.")
                return
            }
            pollAttempt += 1
            // Shaped to when the answer can actually EXIST, not to attempt
            // count. A fresh scan can't finish before ~10s (acquire ~5s, then
            // analysis), so the old 2.5s-then-4s backoff polled hardest while
            // nothing could have happened and eased off exactly when completion
            // became likely — a finished scan could sit undiscovered for 4s.
            // The server throttles its `lastPolledAt` write to ~once/15s, so
            // polling tighter costs a read, not a write.
            let elapsed = Date().timeIntervalSince(submittedAt)
            let delayNanoseconds: UInt64 = elapsed < 8 ? 2_000_000_000
                : elapsed < 60 ? 1_200_000_000
                : 2_500_000_000
            try? await Task.sleep(nanoseconds: delayNanoseconds)
            if Task.isCancelled { return }

            do {
                let job = try await api.getExtraction(jobId: jobId)
                if Task.isCancelled { return }
                phase = .working(stage: job.stage, thumbnail: job.videoThumbnail)
                if job.status == "done" { finalize(job); return }
                if job.status == "failed" {
                    phase = .error(message: "it might be private or unavailable.")
                    return
                }
            } catch {
                // Transient network hiccup — same tolerance as the web client's poll().
            }
        }
    }

    private func finalize(_ job: ExtractionJobDTO) {
        let films = job.films ?? []
        self.films = films
        self.included = Set(films.map { $0.tmdbId })
        let suggested = job.suggestedListName?.trimmingCharacters(in: .whitespacesAndNewlines)
        self.newListName = (suggested?.isEmpty == false ? suggested! : nil) ?? "new films"
        self.destination = .newList
        self.saveErrorMessage = nil
        self.phase = .ready
        startReveal(count: films.count)
    }

    /// The slot-machine payoff: films land one at a time, each with its own
    /// haptic tick, the last one heavier. The view animates on
    /// `revealedCount`; skipping straight to the end (tiny lists) would waste
    /// the wait the user just paid for.
    private func startReveal(count: Int) {
        revealTask?.cancel()
        revealedCount = 0
        guard count > 0 else { return }
        // Big lists reveal faster per row — the drama scales, the total wait
        // doesn't (10 films at full stagger would gate saving for ~4s).
        let stepNs: UInt64 = count > 5 ? 230_000_000 : 380_000_000
        revealTask = Task { [weak self] in
            for i in 1...count {
                try? await Task.sleep(nanoseconds: i == 1 ? 300_000_000 : stepNs)
                guard let self, !Task.isCancelled else { return }
                self.revealedCount = i
                UIImpactFeedbackGenerator(style: i == count ? .medium : .light).impactOccurred()
            }
        }
    }

    private func handle(error: Error) async {
        if let apiError = error as? APIError {
            switch apiError {
            case .unauthorized, .noCredential:
                phase = .signedOut
                return
            case .quotaExceeded:
                phase = .quotaExceeded
                return
            default:
                break
            }
        }
        phase = .error(message: "it might be private or unavailable.")
    }

    // MARK: - Result screen actions

    func toggleIncluded(_ tmdbId: Int) {
        if included.contains(tmdbId) { included.remove(tmdbId) } else { included.insert(tmdbId) }
    }

    /// The dropdown row's value line. For a new list this is a STATIC label —
    /// the name lives in the field right below, so echoing it here would show
    /// the same text twice.
    var destinationLabel: String {
        switch destination {
        case .newList:
            return "a new list"
        case .existing(_, _, let name):
            return name
        }
    }

    var includedCount: Int {
        films.filter { included.contains($0.tmdbId) }.count
    }

    /// Opens the destination picker, lazily fetching the caller's own AND
    /// shared-with-them lists the first time (never pre-fetched — keeps the
    /// happy path to one less call). Mirrors the in-app picker: own lists
    /// first with visibility + count, then collaborator lists as "shared by X".
    func openPicker() {
        showPicker = true
        guard lists.isEmpty, !isLoadingLists else { return }
        isLoadingLists = true
        Task { [weak self] in
            guard let self else { return }
            async let ownFetch = try? self.api.getLists()
            async let sharedFetch = try? self.api.getSharedLists()
            let (own, shared) = await (ownFetch, sharedFetch)
            let uid = await self.api.credentialUid() ?? ""

            var items: [PickerListItem] = []
            for l in own ?? [] {
                let count = l.movieCount ?? 0
                let visibility = (l.isPublic ?? false) ? "public" : "private"
                items.append(PickerListItem(
                    id: l.id,
                    ownerId: l.ownerId ?? uid,
                    name: l.name,
                    coverImageUrl: l.coverImageUrl,
                    subtitle: "\(visibility) · \(count) \(count == 1 ? "film" : "films")"
                ))
            }
            for l in shared ?? [] {
                items.append(PickerListItem(
                    id: l.id,
                    ownerId: l.ownerId,
                    name: l.name,
                    coverImageUrl: l.coverImageUrl,
                    subtitle: "shared by \(l.ownerDisplayName ?? l.ownerUsername ?? "a friend")"
                ))
            }
            await MainActor.run {
                self.isLoadingLists = false
                if !items.isEmpty { self.lists = items }
            }
        }
    }

    func pick(_ list: PickerListItem) {
        destination = .existing(id: list.id, ownerId: list.ownerId, name: list.name)
        showPicker = false
    }

    func pickNew() {
        destination = .newList
        showPicker = false
    }

    func save() {
        guard !isSaving, let jobId else { return }
        let selected = films.filter { included.contains($0.tmdbId) }
        guard !selected.isEmpty else { return }

        isSaving = true
        saveErrorMessage = nil

        Task { [weak self] in
            guard let self else { return }
            do {
                let body: SaveBody
                switch await self.destinationSnapshot() {
                case .newList:
                    let name = await self.newListNameSnapshot()
                    body = SaveBody(
                        createLists: [CreateListSpec(tempId: "new", name: name)],
                        items: selected.map {
                            SaveItem(tmdbId: $0.tmdbId, mediaType: $0.mediaType,
                                     target: SaveTarget(tempId: "new", ownerId: nil, listId: nil))
                        }
                    )
                case .existing(let listId, let ownerId, _):
                    body = SaveBody(
                        createLists: [],
                        items: selected.map {
                            SaveItem(tmdbId: $0.tmdbId, mediaType: $0.mediaType,
                                     target: SaveTarget(tempId: nil, ownerId: ownerId, listId: listId))
                        }
                    )
                }

                let response = try await self.api.saveExtraction(jobId: jobId, body: body)
                let successCount = response.results.filter { $0.ok }.count
                guard successCount > 0 else {
                    await self.saveFailed(message: "couldn't save. try again.")
                    return
                }
                await self.saveSucceeded(response: response, selectedFilms: selected)
            } catch {
                await self.saveFailed(message: "couldn't save. try again.")
            }
        }
    }

    private func destinationSnapshot() async -> Destination { destination }
    private func newListNameSnapshot() async -> String {
        let trimmed = newListName.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "new list" : trimmed
    }

    private func saveSucceeded(response: SaveResponseDTO, selectedFilms: [ExtractionFilmDTO]) async {
        isSaving = false
        // The done state names the ACTUAL destination (destinationLabel says
        // "a new list" for the dropdown — here we want the real list name).
        let name: String
        switch destination {
        case .newList:
            let trimmed = newListName.trimmingCharacters(in: .whitespacesAndNewlines)
            name = trimmed.isEmpty ? "new list" : trimmed
        case .existing(_, _, let existingName):
            name = existingName
        }

        // MN01 — capture the REAL destination list identity. `results` is in
        // the same order as `selectedFilms` (the server appends one result
        // per input item, in order), so zipping them tells us exactly which
        // films landed — a single-film success prefills `savedFilm`.
        let succeeded = zip(selectedFilms, response.results).filter { $0.1.ok }.map { $0.0 }
        savedFilm = succeeded.count == 1 ? succeeded[0] : nil
        savedListId = response.results.first(where: { $0.ok })?.listId
        switch destination {
        case .newList:
            savedListOwnerId = await api.credentialUid()
        case .existing(_, let ownerId, _):
            savedListOwnerId = ownerId
        }
        canPlanNight = savedListId != nil && savedListOwnerId != nil

        phase = .done(listName: name)
        scheduleAutoClose()
    }

    private func saveFailed(message: String) {
        isSaving = false
        saveErrorMessage = message
    }

    private func scheduleAutoClose() {
        autoCloseTask?.cancel()
        // The "plan a movie night" button needs real time to be noticed and
        // tapped — the header X is always available for an earlier close
        // either way, so a longer wait here costs nothing.
        let delayNanoseconds: UInt64 = canPlanNight ? 5_000_000_000 : 1_200_000_000
        autoCloseTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: delayNanoseconds)
            guard let self, !Task.isCancelled else { return }
            self.onFinish?()
        }
    }

    // MARK: - Signed-out / error fallback (the ONLY app-open path)

    func openApp() {
        onOpenApp?(sharedURL)
    }

    // MARK: - MN01 — plan a movie night (secondary action on the done state)

    /// Builds `cinechrony://plan-night?listOwnerId=…&listId=…[&tmdbId=…&mediaType=…]`.
    /// `nil` whenever the real destination identity wasn't captured — the
    /// button isn't shown in that case (`canPlanNight`), but this stays
    /// defensive regardless.
    private func planNightDeepLink() -> URL? {
        guard let listOwnerId = savedListOwnerId, let listId = savedListId else { return nil }
        var components = URLComponents()
        components.scheme = "cinechrony"
        components.host = "plan-night"
        var items = [
            URLQueryItem(name: "listOwnerId", value: listOwnerId),
            URLQueryItem(name: "listId", value: listId),
        ]
        if let film = savedFilm {
            items.append(URLQueryItem(name: "tmdbId", value: String(film.tmdbId)))
            items.append(URLQueryItem(name: "mediaType", value: film.mediaType))
        }
        components.queryItems = items
        return components.url
    }

    /// The done state's secondary button action — opens the host app
    /// deep-linked straight into the create-night flow, prefilled with the
    /// list this save just landed in (+ the film, when exactly one was saved).
    func planMovieNight() {
        guard let url = planNightDeepLink() else { return }
        autoCloseTask?.cancel()
        onPlanNight?(url)
    }
}
