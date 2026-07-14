//
//  ShareFlowView.swift
//  Cinechrony Share Extension (Phase C.3 — Corner-style in-place drawer)
//
//  The whole visual surface: a bottom-anchored sheet over a dimmed background,
//  hosted (via UIHostingController) inside ShareViewController. iOS 15
//  deployment target — SwiftUI APIs used here are all iOS 15-safe (AsyncImage
//  is fine; NO presentationDetents / Text.tracking / NavigationStack, which are
//  iOS 16+).
//
//  Brand: paper / ink / film-red, lowercase copy, system font, no emoji, no
//  em/en dashes in copy.
//

import SwiftUI
import UIKit

// MARK: - Brand

private enum Brand {
    static let paper = Color(
        light: UIColor(red: 0xF7 / 255, green: 0xF3 / 255, blue: 0xEB / 255, alpha: 1),
        dark: UIColor(red: 0x1F / 255, green: 0x1B / 255, blue: 0x16 / 255, alpha: 1)
    )
    static let ink = Color(
        light: UIColor(red: 0x21 / 255, green: 0x1D / 255, blue: 0x17 / 255, alpha: 1),
        dark: UIColor(red: 0xED / 255, green: 0xE8 / 255, blue: 0xDF / 255, alpha: 1)
    )
    static let filmRed = Color(
        light: UIColor(red: 0xC9 / 255, green: 0x3F / 255, blue: 0x26 / 255, alpha: 1),
        dark: UIColor(red: 0xE4 / 255, green: 0x59 / 255, blue: 0x3B / 255, alpha: 1)
    )
    static let sunken = Color(
        light: UIColor(white: 0, alpha: 0.045),
        dark: UIColor(white: 1, alpha: 0.08)
    )
    static let hairline = Color(
        light: UIColor(white: 0, alpha: 0.1),
        dark: UIColor(white: 1, alpha: 0.14)
    )
    static let muted = Color(
        light: UIColor(white: 0.32, alpha: 1),
        dark: UIColor(white: 0.68, alpha: 1)
    )
}

private extension Color {
    init(light: UIColor, dark: UIColor) {
        self.init(UIColor { traits in
            traits.userInterfaceStyle == .dark ? dark : light
        })
    }
}

// MARK: - Shapes / small controls

private struct TopRoundedRect: Shape {
    var radius: CGFloat = 24
    func path(in rect: CGRect) -> Path {
        Path(UIBezierPath(
            roundedRect: rect,
            byRoundingCorners: [.topLeft, .topRight],
            cornerRadii: CGSize(width: radius, height: radius)
        ).cgPath)
    }
}

private struct PrimaryButton: View {
    let title: String
    var isLoading: Bool = false
    var disabled: Bool = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if isLoading {
                    ProgressView().progressViewStyle(CircularProgressViewStyle(tint: .white))
                }
                Text(title).font(.system(size: 16, weight: .bold))
            }
            .foregroundColor(.white)
            .frame(maxWidth: .infinity)
            .frame(height: 50)
            .background(disabled ? Brand.filmRed.opacity(0.45) : Brand.filmRed)
            .clipShape(Capsule())
        }
        .disabled(disabled)
        .buttonStyle(.plain)
    }
}

private struct SecondaryButton: View {
    let title: String
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 15, weight: .semibold))
                .foregroundColor(Brand.ink)
                .frame(height: 44)
                .padding(.horizontal, 20)
                .background(Brand.sunken)
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Root

struct ShareFlowView: View {
    @ObservedObject var model: ShareFlowModel
    @State private var appeared = false

    var body: some View {
        ZStack(alignment: .bottom) {
            Color.black.opacity(appeared ? 0.35 : 0)
                .ignoresSafeArea()

            sheetCard
                .offset(y: appeared ? 0 : 600)
        }
        .onAppear {
            withAnimation(.spring(response: 0.4, dampingFraction: 0.86)) {
                appeared = true
            }
        }
    }

    private var sheetCard: some View {
        VStack(spacing: 0) {
            Capsule()
                .fill(Brand.hairline)
                .frame(width: 40, height: 4)
                .padding(.top, 8)

            header

            content
                .animation(.easeInOut(duration: 0.2), value: model.phase)
        }
        .background(Brand.paper)
        .clipShape(TopRoundedRect(radius: 24))
        .frame(maxWidth: .infinity)
    }

    private var header: some View {
        HStack {
            Text("add to cinechrony")
                .font(.system(size: 19, weight: .bold))
                .foregroundColor(Brand.ink)
            Spacer()
            Button(action: { model.close() }) {
                Image(systemName: "xmark")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(Brand.ink)
                    .frame(width: 44, height: 44)
            }
            .buttonStyle(.plain)
        }
        .padding(.leading, 20)
        .padding(.trailing, 8)
        .padding(.top, 6)
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .working(let stage, let thumbnail):
            WorkingStateView(stageLabel: model.stageLabels[stage] ?? "working", thumbnailUrl: thumbnail)
        case .signedOut:
            SignedOutStateView(onOpenApp: { model.openApp() })
        case .error(let message):
            ErrorStateView(message: message, onRetry: { model.retry() }, onOpenApp: { model.openApp() })
        case .ready:
            ResultStateView(model: model)
        case .done(let listName):
            DoneStateView(listName: listName)
        }
    }
}

// MARK: - State 1: resolving/submitting + scanning

private struct WorkingStateView: View {
    let stageLabel: String
    let thumbnailUrl: String?

    var body: some View {
        VStack(spacing: 14) {
            if let thumbnailUrl, let url = URL(string: thumbnailUrl) {
                AsyncImage(url: url) { image in
                    image.resizable().aspectRatio(contentMode: .fill)
                } placeholder: {
                    Rectangle().fill(Brand.sunken)
                }
                .frame(width: 92, height: 92)
                .clipShape(RoundedRectangle(cornerRadius: 16))
            }

            ProgressView()
                .progressViewStyle(CircularProgressViewStyle(tint: Brand.filmRed))
                .scaleEffect(1.15)

            Text(stageLabel)
                .font(.system(size: 20, weight: .bold))
                .foregroundColor(Brand.ink)

            Text("close anytime. we'll ping you when it's ready.")
                .font(.system(size: 14))
                .foregroundColor(Brand.muted)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
        }
        .padding(.vertical, 34)
        .frame(maxWidth: .infinity)
    }
}

// MARK: - State 2: signed out

private struct SignedOutStateView: View {
    let onOpenApp: () -> Void
    var body: some View {
        VStack(spacing: 14) {
            Text("sign in to cinechrony first")
                .font(.system(size: 20, weight: .bold))
                .foregroundColor(Brand.ink)
                .multilineTextAlignment(.center)
            Text("open the app, sign in, then share again.")
                .font(.system(size: 15))
                .foregroundColor(Brand.muted)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 24)
            PrimaryButton(title: "open cinechrony", action: onOpenApp)
                .padding(.horizontal, 20)
                .padding(.top, 6)
        }
        .padding(.vertical, 34)
        .frame(maxWidth: .infinity)
    }
}

// MARK: - State 3: error

private struct ErrorStateView: View {
    let message: String
    let onRetry: () -> Void
    let onOpenApp: () -> Void

    var body: some View {
        VStack(spacing: 14) {
            Text("couldn't scan that video")
                .font(.system(size: 20, weight: .bold))
                .foregroundColor(Brand.ink)
                .multilineTextAlignment(.center)
            Text(message)
                .font(.system(size: 15))
                .foregroundColor(Brand.muted)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 24)
            HStack(spacing: 10) {
                SecondaryButton(title: "try again", action: onRetry)
                SecondaryButton(title: "open cinechrony", action: onOpenApp)
            }
            .padding(.top, 6)
        }
        .padding(.vertical, 34)
        .frame(maxWidth: .infinity)
    }
}

// MARK: - State 4 + 5: result / saving

private struct ResultStateView: View {
    @ObservedObject var model: ShareFlowModel

    var body: some View {
        VStack(spacing: 0) {
            Text(countLabel)
                .font(.system(size: 20, weight: .bold))
                .foregroundColor(Brand.ink)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 20)
                .padding(.top, 4)
                .padding(.bottom, 12)

            destinationSection

            ScrollView {
                VStack(spacing: 0) {
                    ForEach(model.films) { film in
                        FilmRow(
                            film: film,
                            isIncluded: model.included.contains(film.tmdbId),
                            onToggle: { model.toggleIncluded(film.tmdbId) }
                        )
                        Rectangle().fill(Brand.hairline).frame(height: 1)
                    }
                }
                .padding(.horizontal, 20)
            }
            .frame(maxHeight: 300)
            .padding(.top, 12)

            if let err = model.saveErrorMessage {
                Text(err)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(Brand.filmRed)
                    .padding(.top, 8)
                    .padding(.horizontal, 20)
            }

            PrimaryButton(
                title: model.isSaving ? "saving" : "add \(model.includedCount) \(model.includedCount == 1 ? "film" : "films")",
                isLoading: model.isSaving,
                disabled: model.includedCount == 0 || model.isSaving,
                action: { model.save() }
            )
            .padding(.horizontal, 20)
            .padding(.top, 14)
            .padding(.bottom, 20)
        }
        .sheet(isPresented: $model.showPicker) {
            ListPickerView(model: model)
        }
    }

    private var countLabel: String {
        let n = model.films.count
        return "\(n) \(n == 1 ? "film" : "films") found"
    }

    /// The in-app pattern (list-picker hosts): the destination itself is ALWAYS
    /// a dropdown row — tap it to open the picker — and the new-list name field
    /// appears beneath it only while "create a new list" is the destination.
    private var destinationSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button(action: { model.openPicker() }) {
                HStack(spacing: 12) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 10)
                            .fill(Brand.filmRed.opacity(0.1))
                            .frame(width: 40, height: 40)
                        Image(systemName: "text.badge.plus")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundColor(Brand.filmRed)
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        Text("adding to")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundColor(Brand.muted)
                            .textCase(.uppercase)
                        Text(model.destinationLabel)
                            .font(.system(size: 16, weight: .bold))
                            .foregroundColor(Brand.ink)
                            .lineLimit(1)
                    }
                    Spacer()
                    Image(systemName: "chevron.down")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(Brand.muted)
                }
                .padding(.horizontal, 12)
                .frame(height: 60)
                .background(Brand.sunken)
                .clipShape(RoundedRectangle(cornerRadius: 14))
            }
            .buttonStyle(.plain)

            if case .newList = model.destination {
                TextField("name your new list", text: $model.newListName)
                    .font(.system(size: 16, weight: .bold))
                    .foregroundColor(Brand.ink)
                    .padding(.horizontal, 14)
                    .frame(height: 48)
                    .background(Brand.filmRed.opacity(0.05))
                    .overlay(
                        RoundedRectangle(cornerRadius: 14).stroke(Brand.filmRed.opacity(0.28), lineWidth: 1)
                    )
                    .clipShape(RoundedRectangle(cornerRadius: 14))
            }
        }
        .padding(.horizontal, 20)
    }
}

private struct FilmRow: View {
    let film: ExtractionFilmDTO
    let isIncluded: Bool
    let onToggle: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            poster
            VStack(alignment: .leading, spacing: 3) {
                Text(film.title)
                    .font(.system(size: 16, weight: .bold))
                    .foregroundColor(Brand.ink)
                    .lineLimit(1)
                HStack(spacing: 4) {
                    Text(metaLabel)
                        .font(.system(size: 11, weight: .medium, design: .monospaced))
                        .foregroundColor(Brand.muted)
                    if let match = matchLabel {
                        Text("· \(match)")
                            .font(.system(size: 11, weight: .semibold, design: .monospaced))
                            .foregroundColor(matchIsLow ? Brand.filmRed : Brand.muted)
                    }
                }
                .lineLimit(1)
            }
            Spacer()
            Toggle("", isOn: Binding(get: { isIncluded }, set: { _ in onToggle() }))
                .labelsHidden()
                .tint(Brand.filmRed)
        }
        .padding(.vertical, 10)
        .frame(minHeight: 44)
    }

    /// "1984 · imdb 7.4" — year (or media kind) plus the IMDb score when known.
    private var metaLabel: String {
        var parts: [String] = []
        if let year = film.year, !year.isEmpty { parts.append(year) }
        else { parts.append(film.mediaType == "tv" ? "tv series" : "film") }
        if let imdb = film.imdbRating, !imdb.isEmpty { parts.append("imdb \(imdb)") }
        return parts.joined(separator: " · ")
    }

    /// Same confidence tiers as the web ConfidenceChip: silent when the match
    /// is strong, a percentage when decent, a film-red warning when shaky.
    private var matchLabel: String? {
        guard let c = film.confidence, c < 0.8 else { return nil }
        if c < 0.6 { return "low match, double-check" }
        return "\(Int((c * 100).rounded()))% match"
    }

    private var matchIsLow: Bool {
        (film.confidence ?? 1) < 0.6
    }

    @ViewBuilder
    private var poster: some View {
        if let posterUrl = film.posterUrl, let url = URL(string: posterUrl) {
            AsyncImage(url: url) { image in
                image.resizable().aspectRatio(contentMode: .fill)
            } placeholder: {
                Rectangle().fill(Brand.sunken)
            }
            .frame(width: 44, height: 66)
            .clipShape(RoundedRectangle(cornerRadius: 8))
        } else {
            RoundedRectangle(cornerRadius: 8).fill(Brand.sunken).frame(width: 44, height: 66)
        }
    }
}

// MARK: - Destination picker sheet (mirrors the app's ListPickerSheet:
// highlighted create-new card → "your lists" mono header → cover + name +
// visibility·count / shared-by rows. Tapping a row picks it and dismisses.)

private struct ListPickerView: View {
    @ObservedObject var model: ShareFlowModel

    var body: some View {
        VStack(spacing: 0) {
            Capsule()
                .fill(Brand.hairline)
                .frame(width: 40, height: 4)
                .padding(.top, 10)

            HStack {
                Text("add to")
                    .font(.system(size: 19, weight: .bold))
                    .foregroundColor(Brand.ink)
                Spacer()
                Button(action: { model.showPicker = false }) {
                    Image(systemName: "xmark")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(Brand.ink)
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
            }
            .padding(.leading, 20)
            .padding(.trailing, 8)
            .padding(.top, 6)

            if model.isLoadingLists && model.lists.isEmpty {
                Spacer()
                ProgressView()
                    .progressViewStyle(CircularProgressViewStyle(tint: Brand.filmRed))
                Spacer()
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        createNewRow

                        if !model.lists.isEmpty {
                            Text("your lists")
                                .font(.system(size: 11, weight: .bold, design: .monospaced))
                                .foregroundColor(Brand.muted)
                                .textCase(.uppercase)
                                .padding(.horizontal, 12)
                                .padding(.top, 16)
                                .padding(.bottom, 6)
                        }

                        ForEach(model.lists) { list in
                            listRow(list)
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.bottom, 28)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Brand.paper.ignoresSafeArea())
    }

    private var isNewActive: Bool {
        if case .newList = model.destination { return true }
        return false
    }

    private var createNewRow: some View {
        Button(action: { model.pickNew() }) {
            HStack(spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 10)
                        .fill(Brand.filmRed.opacity(0.1))
                        .frame(width: 44, height: 44)
                    Image(systemName: "text.badge.plus")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundColor(Brand.filmRed)
                }
                Text("create a new list")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(Brand.filmRed)
                Spacer()
                if isNewActive {
                    Image(systemName: "checkmark")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundColor(Brand.filmRed)
                }
            }
            .padding(12)
            .background(isNewActive ? Brand.filmRed.opacity(0.06) : Color.clear)
            .clipShape(RoundedRectangle(cornerRadius: 14))
        }
        .buttonStyle(.plain)
    }

    private func listRow(_ list: PickerListItem) -> some View {
        let isActive: Bool = {
            if case .existing(let id, _, _) = model.destination, id == list.id { return true }
            return false
        }()
        return Button(action: { model.pick(list) }) {
            HStack(spacing: 12) {
                cover(list)
                VStack(alignment: .leading, spacing: 3) {
                    Text(list.name)
                        .font(.system(size: 16, weight: .bold))
                        .foregroundColor(Brand.ink)
                        .lineLimit(1)
                    Text(list.subtitle)
                        .font(.system(size: 12, weight: .medium, design: .monospaced))
                        .foregroundColor(Brand.muted)
                        .lineLimit(1)
                }
                Spacer()
                if isActive {
                    Image(systemName: "checkmark")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundColor(Brand.filmRed)
                }
            }
            .padding(.vertical, 8)
            .padding(.horizontal, 12)
            .background(isActive ? Brand.filmRed.opacity(0.06) : Color.clear)
            .clipShape(RoundedRectangle(cornerRadius: 14))
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private func cover(_ list: PickerListItem) -> some View {
        if let coverUrl = list.coverImageUrl, let url = URL(string: coverUrl) {
            AsyncImage(url: url) { image in
                image.resizable().aspectRatio(contentMode: .fill)
            } placeholder: {
                RoundedRectangle(cornerRadius: 10).fill(Brand.sunken)
            }
            .frame(width: 44, height: 44)
            .clipShape(RoundedRectangle(cornerRadius: 10))
        } else {
            ZStack {
                RoundedRectangle(cornerRadius: 10).fill(Brand.sunken)
                Image(systemName: "film")
                    .font(.system(size: 16))
                    .foregroundColor(Brand.muted)
            }
            .frame(width: 44, height: 44)
        }
    }
}

// MARK: - Done

private struct DoneStateView: View {
    let listName: String
    var body: some View {
        VStack(spacing: 14) {
            ZStack {
                Circle().fill(Brand.filmRed.opacity(0.1)).frame(width: 64, height: 64)
                Image(systemName: "checkmark")
                    .font(.system(size: 24, weight: .bold))
                    .foregroundColor(Brand.filmRed)
            }
            Text("added to \(listName)")
                .font(.system(size: 20, weight: .bold))
                .foregroundColor(Brand.ink)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 24)
        }
        .padding(.vertical, 40)
        .frame(maxWidth: .infinity)
    }
}
