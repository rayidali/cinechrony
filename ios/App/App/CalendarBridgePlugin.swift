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
//  iOS 17+: Apple's edit view controller can be presented WITHOUT the app
//  first holding calendar authorization — a fresh `EKEventStore` is handed
//  straight to the edit VC and the system handles access itself. Pre-17: the
//  app must hold access before presenting, so we request it (write-only
//  where the API exists, else full) first; a denial rejects the call rather
//  than presenting a sheet that can't save.
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
        guard pendingCall == nil else {
            call.reject("a calendar sheet is already open")
            return
        }
        let notes = call.getString("notes")
        let urlString = call.getString("url")

        // A fresh store per invocation — no shared authorization state to
        // get stale across calls.
        let store = EKEventStore()

        if #available(iOS 17.0, *) {
            // The edit VC manages its own access on 17+ — present directly,
            // no authorization round trip needed.
            presentEditor(call: call, store: store, title: title, startMs: startMs, endMs: endMs, notes: notes, urlString: urlString)
            return
        }

        requestLegacyAccess(store: store) { [weak self] granted in
            DispatchQueue.main.async {
                guard granted else {
                    call.reject("denied")
                    return
                }
                self?.presentEditor(call: call, store: store, title: title, startMs: startMs, endMs: endMs, notes: notes, urlString: urlString)
            }
        }
    }

    /// Pre-17 only: request calendar access before presenting. Write-only
    /// access (`requestWriteOnlyAccessToEvents`) is preferred where the API
    /// exists — this app only ever needs to CREATE events, never read the
    /// user's existing calendar — falling back to the legacy full-access
    /// request on OS versions that don't have it.
    private func requestLegacyAccess(store: EKEventStore, completion: @escaping (Bool) -> Void) {
        if #available(iOS 17.0, *) {
            store.requestWriteOnlyAccessToEvents { granted, _ in completion(granted) }
        } else {
            store.requestAccess(to: .event) { granted, _ in completion(granted) }
        }
    }

    private func presentEditor(
        call: CAPPluginCall,
        store: EKEventStore,
        title: String,
        startMs: Double,
        endMs: Double,
        notes: String?,
        urlString: String?
    ) {
        guard let viewController = bridge?.viewController else {
            call.reject("no view controller to present from")
            return
        }

        let event = EKEvent(eventStore: store)
        event.title = title
        event.startDate = Date(timeIntervalSince1970: startMs / 1000)
        event.endDate = Date(timeIntervalSince1970: endMs / 1000)
        event.notes = notes
        if let urlString, let url = URL(string: urlString) {
            event.url = url
        }
        if let defaultCalendar = store.defaultCalendarForNewEvents {
            event.calendar = defaultCalendar
        }

        let editVC = EKEventEditViewController()
        editVC.event = event
        editVC.eventStore = store
        editVC.editViewDelegate = self

        pendingCall = call
        pendingStore = store

        DispatchQueue.main.async {
            viewController.present(editVC, animated: true)
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
