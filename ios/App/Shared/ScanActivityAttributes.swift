//
//  ScanActivityAttributes.swift
//  Cinechrony — shared between the App target and ScanActivityWidget
//  (one source file, two target memberships — the type NAME is the wire
//  contract: APNs push-to-start payloads carry `attributes-type:
//  "ScanActivityAttributes"` and ActivityKit matches on it).
//
//  ContentState MUST stay key-for-key identical to the server's
//  `LaContentState` (src/lib/live-activity-server.ts) — ActivityKit decodes
//  the push's `content-state` dict with Codable, and a missing non-optional
//  key silently drops the update.
//

import Foundation
#if canImport(ActivityKit)
import ActivityKit

@available(iOS 16.2, *)
struct ScanActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        /// 1 fetching · 2 watching · 3 matching · 4 terminal (monotonic).
        var stage: Int
        /// Headline: "watching it", "2 films found".
        var label: String
        /// Optional second line: "Party (1984) · imdb 7.4".
        var detail: String?
        /// "working" | "done" | "zero" | "failed".
        var state: String
    }

    /// Fixed at start — the card deep-links to /extract?jobId=….
    var jobId: String
}
#endif
