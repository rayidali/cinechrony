//
//  ScanActivityLiveActivity.swift
//  ScanActivityWidget — the card itself. Renders whatever full-state
//  content the last-delivered push carried (idempotent by design: any
//  single update draws a complete, correct card).
//
//  Brand: the "projection room" dark look — near-black paper, cream ink,
//  film-red accents. Lowercase copy, no emoji, no em/en dashes. A fixed
//  dark card reads premium on any wallpaper and matches the app's dark
//  theme.
//

import ActivityKit
import SwiftUI
import WidgetKit

// MARK: - Brand (fixed dark — lock screen wallpaper is unknowable)

private enum CardBrand {
    static let paper = Color(red: 0x1F / 255, green: 0x1B / 255, blue: 0x16 / 255)
    static let ink = Color(red: 0xED / 255, green: 0xE8 / 255, blue: 0xDF / 255)
    static let filmRed = Color(red: 0xE4 / 255, green: 0x59 / 255, blue: 0x3B / 255)
    static let muted = Color.white.opacity(0.55)
    static let dotOff = Color.white.opacity(0.18)
}

private func deepLink(_ jobId: String) -> URL? {
    URL(string: "cinechrony://extract?jobId=\(jobId)")
}

// MARK: - Widget

struct ScanActivityLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: ScanActivityAttributes.self) { context in
            // Lock screen / banner
            LockScreenCard(state: context.state)
                .activityBackgroundTint(CardBrand.paper)
                .activitySystemActionForegroundColor(CardBrand.ink)
                .widgetURL(deepLink(context.attributes.jobId))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    IconTile()
                        .padding(.leading, 2)
                }
                DynamicIslandExpandedRegion(.center) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(context.state.label)
                            .font(.system(size: 15, weight: .bold))
                            .foregroundColor(CardBrand.ink)
                            .lineLimit(1)
                        if let detail = context.state.detail, !detail.isEmpty {
                            Text(detail)
                                .font(.system(size: 11, weight: .medium, design: .monospaced))
                                .foregroundColor(CardBrand.muted)
                                .lineLimit(1)
                        }
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    TrailingStatus(state: context.state)
                        .padding(.trailing, 2)
                }
            } compactLeading: {
                Image("CinechronyIcon")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 20, height: 20)
            } compactTrailing: {
                CompactStatus(state: context.state)
            } minimal: {
                Image("CinechronyIcon")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 20, height: 20)
            }
            .widgetURL(deepLink(context.attributes.jobId))
            .keylineTint(CardBrand.filmRed)
        }
    }
}

// MARK: - Lock screen card

private struct LockScreenCard: View {
    let state: ScanActivityAttributes.ContentState

    var body: some View {
        HStack(spacing: 12) {
            IconTile()
            VStack(alignment: .leading, spacing: 2) {
                Text("CINECHRONY")
                    .font(.system(size: 9, weight: .bold, design: .monospaced))
                    .foregroundColor(CardBrand.muted)
                Text(state.label)
                    .font(.system(size: 16, weight: .bold))
                    .foregroundColor(CardBrand.ink)
                    .lineLimit(1)
                if let detail = state.detail, !detail.isEmpty {
                    Text(detail)
                        .font(.system(size: 12, weight: .medium, design: .monospaced))
                        .foregroundColor(CardBrand.muted)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            TrailingStatus(state: state)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
    }
}

// MARK: - Pieces

/// The brand tile — the cinechrony popcorn itself (bundled asset), constant
/// across states (the trailing status carries the state; the tile carries
/// the brand).
private struct IconTile: View {
    var body: some View {
        Image("CinechronyIcon")
            .resizable()
            .scaledToFit()
            .frame(width: 38, height: 38)
    }
}

/// Right side of the card: 4 stage dots while working, a resolved glyph
/// once terminal.
private struct TrailingStatus: View {
    let state: ScanActivityAttributes.ContentState

    var body: some View {
        switch state.state {
        case "working":
            HStack(spacing: 5) {
                ForEach(0..<4, id: \.self) { index in
                    Circle()
                        .fill(index < state.stage ? CardBrand.filmRed : CardBrand.dotOff)
                        .frame(width: 6, height: 6)
                }
            }
        case "done":
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 22, weight: .semibold))
                .foregroundColor(CardBrand.filmRed)
        case "zero":
            Image(systemName: "sparkles")
                .font(.system(size: 18, weight: .semibold))
                .foregroundColor(CardBrand.muted)
        default: // failed
            Image(systemName: "arrow.clockwise.circle.fill")
                .font(.system(size: 22, weight: .semibold))
                .foregroundColor(CardBrand.filmRed)
        }
    }
}

/// Dynamic Island compact trailing: a tiny stage gauge → resolved glyph.
private struct CompactStatus: View {
    let state: ScanActivityAttributes.ContentState

    var body: some View {
        switch state.state {
        case "working":
            ProgressView(value: Double(min(state.stage, 4)), total: 4)
                .progressViewStyle(.circular)
                .tint(CardBrand.filmRed)
        case "done":
            Image(systemName: "checkmark")
                .font(.system(size: 13, weight: .bold))
                .foregroundColor(CardBrand.filmRed)
        case "zero":
            Image(systemName: "sparkles")
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(CardBrand.muted)
        default:
            Image(systemName: "exclamationmark")
                .font(.system(size: 13, weight: .bold))
                .foregroundColor(CardBrand.filmRed)
        }
    }
}
