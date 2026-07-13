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

@MainActor
final class ShareFlowModel: ObservableObject {

    enum Phase: Equatable {
        case working(stage: String, thumbnail: String?)
        case signedOut
        case error(message: String)
        case ready
        case done(listName: String)
    }

    enum Destination: Equatable {
        case newList
        case existing(id: String, name: String)
    }

    // MARK: - Published state

    @Published private(set) var phase: Phase
    @Published private(set) var films: [ExtractionFilmDTO] = []
    @Published var included: Set<Int> = []
    @Published var destination: Destination = .newList
    @Published var newListName: String = "new films"
    @Published var isSaving = false
    @Published var saveErrorMessage: String?
    @Published var showPicker = false
    @Published var lists: [ListSummaryDTO] = []
    @Published var isLoadingLists = false

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

    // MARK: - Private

    private let sharedURL: URL
    private let api = ExtensionAPI()
    private var jobId: String?
    private var pollAttempt = 0
    private var submittedAt = Date()
    private var runTask: Task<Void, Never>?

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
    func close() {
        runTask?.cancel()
        onFinish?()
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
            let delayNanoseconds: UInt64 = pollAttempt < 5 ? 2_500_000_000 : 4_000_000_000
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
    }

    private func handle(error: Error) async {
        if let apiError = error as? APIError {
            switch apiError {
            case .unauthorized, .noCredential:
                phase = .signedOut
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

    var destinationLabel: String {
        switch destination {
        case .newList:
            let trimmed = newListName.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? "new list" : trimmed
        case .existing(_, let name):
            return name
        }
    }

    var includedCount: Int {
        films.filter { included.contains($0.tmdbId) }.count
    }

    /// Opens the destination picker, lazily fetching the caller's lists the
    /// first time (never pre-fetched — keeps the happy path to one less call).
    func openPicker() {
        showPicker = true
        guard lists.isEmpty, !isLoadingLists else { return }
        isLoadingLists = true
        Task { [weak self] in
            guard let self else { return }
            let fetched = try? await self.api.getLists()
            await MainActor.run {
                self.isLoadingLists = false
                if let fetched { self.lists = fetched }
            }
        }
    }

    func pick(_ list: ListSummaryDTO) {
        destination = .existing(id: list.id, name: list.name)
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
                let uid = await self.api.credentialUid() ?? ""
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
                case .existing(let listId, _):
                    body = SaveBody(
                        createLists: [],
                        items: selected.map {
                            SaveItem(tmdbId: $0.tmdbId, mediaType: $0.mediaType,
                                     target: SaveTarget(tempId: nil, ownerId: uid, listId: listId))
                        }
                    )
                }

                let response = try await self.api.saveExtraction(jobId: jobId, body: body)
                let successCount = response.results.filter { $0.ok }.count
                guard successCount > 0 else {
                    await self.saveFailed(message: "couldn't save. try again.")
                    return
                }
                await self.saveSucceeded()
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

    private func saveSucceeded() {
        isSaving = false
        let name = destinationLabel
        phase = .done(listName: name)
        scheduleAutoClose()
    }

    private func saveFailed(message: String) {
        isSaving = false
        saveErrorMessage = message
    }

    private func scheduleAutoClose() {
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: 1_200_000_000)
            guard let self, !Task.isCancelled else { return }
            self.onFinish?()
        }
    }

    // MARK: - Signed-out / error fallback (the ONLY app-open path)

    func openApp() {
        onOpenApp?(sharedURL)
    }
}
