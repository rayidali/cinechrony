//
//  LiveActivityPlugin.swift
//  Cinechrony — the app-side half of the lock-screen scan tracker
//  (LIVE-ACTIVITY-PLAN.md). A local Capacitor plugin (no npm package),
//  registered as an instance from AppViewController.capacitorDidLoad()
//  exactly like SharedAuthPlugin — `npx cap sync` can't drop it.
//
//  Why this exists: the share extension can't start a Live Activity
//  (`Activity.request` is app-only) and the hero flow never opens the app,
//  so the SERVER starts it via APNs push-to-start. That needs two rotating
//  tokens ferried to the backend, both observed here and emitted to JS
//  (src/lib/live-activity-native.ts posts them with the user's Bearer):
//
//    pushToStartToken  — per device; lets the server BIRTH an activity.
//    updateToken       — per started activity; lets the server narrate
//                        stages + resolve the card. Carries the jobId from
//                        the activity's attributes so JS knows where to
//                        report it.
//
//  Plus `getActive`/`end` for JS-driven read-repair on app foreground: a
//  card whose job Firestore says is finished gets ended locally, so a
//  dropped APNs end push can never leave the lock screen lying.
//
//  Everything is gated on iOS 17.2 (push-to-start's floor); older systems
//  resolve `watch()` as unsupported and the outcome-push ladder covers them.
//

import Foundation
import Capacitor
#if canImport(ActivityKit)
import ActivityKit
#endif

@objc(LiveActivityPlugin)
public class LiveActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LiveActivityPlugin"
    public let jsName = "LiveActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(#selector(watch(_:)), returnType: .promise),
        CAPPluginMethod(#selector(getActive(_:)), returnType: .promise),
        CAPPluginMethod(#selector(end(_:)), returnType: .promise),
    ]

    private var observing = false
    /// Only ever touched from the single observer Task — no lock needed.
    private var observedActivityIds = Set<String>()

    // MARK: - watch() — start both token observers, report support + current token

    @objc func watch(_ call: CAPPluginCall) {
        guard #available(iOS 17.2, *) else {
            call.resolve(["supported": false])
            return
        }
        startObservers()
        var result: [String: Any] = ["supported": true]
        if let tokenData = Activity<ScanActivityAttributes>.pushToStartToken {
            result["token"] = Self.hex(tokenData)
        }
        call.resolve(result)
    }

    @available(iOS 17.2, *)
    private func startObservers() {
        guard !observing else { return }
        observing = true

        // Stream 1: the per-device push-to-start token (issued on first
        // observation, rotates occasionally — every value goes to JS).
        Task { [weak self] in
            for await tokenData in Activity<ScanActivityAttributes>.pushToStartTokenUpdates {
                self?.notifyListeners(
                    "pushToStartToken",
                    data: ["token": Self.hex(tokenData)],
                    retainUntilConsumed: true
                )
            }
        }

        // Stream 2: activities (existing + newly push-started) → each one's
        // update-token stream. One sequential Task walks both, so the
        // dedupe set never races.
        Task { [weak self] in
            guard let self else { return }
            for activity in Activity<ScanActivityAttributes>.activities {
                self.observeUpdateToken(of: activity)
            }
            for await activity in Activity<ScanActivityAttributes>.activityUpdates {
                self.observeUpdateToken(of: activity)
            }
        }
    }

    @available(iOS 17.2, *)
    private func observeUpdateToken(of activity: Activity<ScanActivityAttributes>) {
        guard !observedActivityIds.contains(activity.id) else { return }
        observedActivityIds.insert(activity.id)

        if let tokenData = activity.pushToken {
            emitUpdateToken(activity: activity, tokenData: tokenData)
        }
        Task { [weak self] in
            for await tokenData in activity.pushTokenUpdates {
                self?.emitUpdateToken(activity: activity, tokenData: tokenData)
            }
        }
    }

    @available(iOS 17.2, *)
    private func emitUpdateToken(activity: Activity<ScanActivityAttributes>, tokenData: Data) {
        notifyListeners(
            "updateToken",
            data: [
                "jobId": activity.attributes.jobId,
                "activityId": activity.id,
                "token": Self.hex(tokenData),
            ],
            retainUntilConsumed: true
        )
    }

    // MARK: - getActive() — the read-repair inventory

    @objc func getActive(_ call: CAPPluginCall) {
        guard #available(iOS 17.2, *) else {
            call.resolve(["activities": [] as [[String: Any]]])
            return
        }
        let items: [[String: Any]] = Activity<ScanActivityAttributes>.activities.map { activity in
            [
                "jobId": activity.attributes.jobId,
                "activityId": activity.id,
                "state": activity.content.state.state,
            ]
        }
        call.resolve(["activities": items])
    }

    // MARK: - end() — local resolution (no push involved)

    @objc func end(_ call: CAPPluginCall) {
        guard #available(iOS 17.2, *) else {
            call.resolve(["ended": false])
            return
        }
        guard let jobId = call.getString("jobId"), !jobId.isEmpty else {
            call.reject("jobId is required")
            return
        }
        let finalState = ScanActivityAttributes.ContentState(
            stage: call.getInt("stage") ?? 4,
            label: call.getString("label") ?? "done",
            detail: call.getString("detail"),
            state: call.getString("state") ?? "done"
        )
        Task {
            for activity in Activity<ScanActivityAttributes>.activities
            where activity.attributes.jobId == jobId {
                await activity.end(
                    ActivityContent(state: finalState, staleDate: nil),
                    dismissalPolicy: .default
                )
            }
            call.resolve(["ended": true])
        }
    }

    // MARK: - Helpers

    private static func hex(_ data: Data) -> String {
        data.map { String(format: "%02x", $0) }.joined()
    }
}
