//
//  CalendarBridgePlugin.swift
//  Cinechrony — native "add to calendar" bridge for movie night events.
//
//  Why this exists (device-confirmed bug): the web app used to `window.open`
//  an https `.ics` URL. iOS treats an https-hosted .ics as a CalDAV
//  SUBSCRIPTION feed, so tapping it surfaced "Add Subscription Calendar" — a
//  read-only, recurring-feed subscribe flow — instead of adding a one-time
//  event. Wrong UX for "add this movie night to your calendar". The fix is
//  the real native sheet: `EKEventEditViewController` (EventKitUI), the same
//  UI Apple's own apps use for "add to calendar".
//
//  A tiny local Capacitor plugin (no npm package), registered as an instance
//  from `AppViewController.capacitorDidLoad()` exactly like SharedAuthPlugin /
//  LiveActivityPlugin — `npx cap sync` can't drop it.
//
//  HARD-LEARNED RULES (build 4 crashed in the field on both counts —
//  TestFlight crash ALqx3DuQ…, iOS 18.1.1, SIGABRT on thread 6):
//   1. Capacitor invokes plugin methods on a BACKGROUND queue. EVERYTHING
//      UIKit here — constructing EKEventEditViewController included, not
//      just presenting it — must run on the main thread.
//   2. NEVER touch `store.defaultCalendarForNewEvents` (or any other
//      calendar READ) on the no-authorization iOS 17+ path. Reads require
//      full access; without it they are nil-or-worse. The edit sheet picks
//      the user's default calendar by itself when `event.calendar` is unset.
//
//  iOS 17+: Apple's edit view controller can be presented WITHOUT the app
//  first holding calendar authorization — a fresh `EKEventStore` is handed
//  straight to the edit VC and the system handles access itself. Pre-17: the
//  app must hold access before presenting, so we request it first; a denial
//  rejects the call rather than presenting a sheet that can't save.
//

import Foundation
import Capacitor
import EventKit
import EventKitUI

@objc(CalendarBridgePlugin)
public class CalendarBridgePlugin: CAPPlugin, CAPBridgedPlugin, EKEventEditViewDelegate {
    public let identifier = "CalendarBridgePlugin"
    public let jsName = "CalendarBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(#selector(addEvent(_:)), returnType: .promise),
    ]

    // The edit VC's delegate callback fires asynchronously (user taps Add /
    // Cancel), well after addEvent() returns — the call + its backing store
    // must stay retained until then. One in-flight sheet at a time.
    private var pendingCall: CAPPluginCall?
    private var pendingStore: EKEventStore?

    // MARK: - addEvent()

    @objc func addEvent(_ call: CAPPluginCall) {
        guard let title = call.getString("title"), !title.isEmpty else {
            call.reject("title is required")
            return
        }
        guard let startMs = call.getDouble("startMs"), let endMs = call.getDouble("endMs") else {
            call.reject("startMs and endMs are required")
            return
        }
        let notes = call.getString("notes")
        let urlString = call.getString("url")
        // A movie night whose showtime is still "tbd" is stored against an
        // 8pm anchor nobody chose (see MovieNightTimeTbd on the web side).
        // Writing that anchor into someone's calendar as a timed block would
        // turn a placeholder into an appointment they plan their evening
        // around, so those go in as all-day instead. Defaults false, which is
        // every event this plugin has ever created.
        let allDay = call.getBool("allDay") ?? false

        // Rule 1: hop to main IMMEDIATELY — every EventKitUI/UIKit touch
        // below (including view-controller construction) is main-thread-only.
        DispatchQueue.main.async { [weak self] in
            guard let self else {
                call.reject("plugin deallocated")
                return
            }
            guard self.pendingCall == nil else {
                call.reject("a calendar sheet is already open")
                return
            }

            // A fresh store per invocation — no shared authorization state
            // to get stale across calls.
            let store = EKEventStore()

            if #available(iOS 17.0, *) {
                // The edit VC manages its own access on 17+ — present
                // directly, no authorization round trip needed.
                self.presentEditor(call: call, store: store, title: title, startMs: startMs, endMs: endMs, allDay: allDay, notes: notes, urlString: urlString)
                return
            }

            store.requestAccess(to: .event) { granted, _ in
                DispatchQueue.main.async {
                    guard granted else {
                        call.reject("denied")
                        return
                    }
                    self.presentEditor(call: call, store: store, title: title, startMs: startMs, endMs: endMs, allDay: allDay, notes: notes, urlString: urlString)
                }
            }
        }
    }

    /// Main-thread only. Builds the event + edit sheet and presents it.
    /// `call` is nil on the smoke path (no JS caller to resolve).
    private func presentEditor(
        call: CAPPluginCall?,
        store: EKEventStore,
        title: String,
        startMs: Double,
        endMs: Double,
        allDay: Bool = false,
        notes: String?,
        urlString: String?
    ) {
        dispatchPrecondition(condition: .onQueue(.main))
        guard let viewController = bridge?.viewController else {
            call?.reject("no view controller to present from")
            return
        }

        let event = EKEvent(eventStore: store)
        event.title = title
        event.startDate = Date(timeIntervalSince1970: startMs / 1000)
        event.endDate = Date(timeIntervalSince1970: endMs / 1000)
        // EventKit derives an all-day event's span from the CALENDAR DAYS the
        // start/end dates fall on, so the anchor times above are simply
        // ignored once this is set — no separate date normalization needed.
        event.isAllDay = allDay
        event.notes = notes
        if let urlString, let url = URL(string: urlString) {
            event.url = url
        }
        // Rule 2: event.calendar stays UNSET — the sheet applies the user's
        // default itself, and reading it here would need full access.

        let editVC = EKEventEditViewController()
        editVC.event = event
        editVC.eventStore = store
        editVC.editViewDelegate = self

        pendingCall = call
        pendingStore = store

        viewController.present(editVC, animated: true)
    }

    // MARK: - headless smoke hook (simulator verification only)

    /// Presents the sheet with a dummy event, exactly through the production
    /// code path minus the JS call plumbing. Driven by the `-smokeCalendar`
    /// launch argument (see AppViewController) so a simulator run +
    /// screenshot can prove this path alive before any build ships. Inert in
    /// normal launches — nothing calls it without the argument.
    ///
    /// `allDay` exists so the "time tbd" movie-night path gets its own
    /// screenshot too (`-smokeCalendarAllDay`). It is not decoration: if the
    /// flag failed to survive the Capacitor bridge, a tbd night would quietly
    /// create a timed 8pm block — the precise outcome the feature exists to
    /// prevent, and one that no amount of compiling proves anything about.
    @objc public func smokePresent(allDay: Bool = false) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            let now = Date().timeIntervalSince1970 * 1000
            self.presentEditor(
                call: nil,
                store: EKEventStore(),
                title: allDay ? "movie night: smoke test (tbd)" : "movie night: smoke test",
                startMs: now + 3_600_000,
                endMs: now + 10_800_000,
                allDay: allDay,
                notes: "cinechrony native smoke",
                urlString: nil
            )
        }
    }

    // MARK: - EKEventEditViewDelegate

    public func eventEditViewController(_ controller: EKEventEditViewController, didCompleteWith action: EKEventEditViewAction) {
        controller.dismiss(animated: true)
        let call = pendingCall
        pendingCall = nil
        pendingStore = nil
        call?.resolve(["saved": action == .saved])
    }
}
