//
//  AppViewController.swift
//  Cinechrony (Phase C.3 — Share Extension credential bridge)
//
//  A CAPBridgeViewController subclass whose ONLY job is to register the local
//  SharedAuthPlugin instance. This is the documented Capacitor 8 path for a
//  custom native plugin that has no npm package (so it can't be auto-discovered
//  via capacitor.config.json's generated `packageClassList` — DO NOT hand-edit
//  that list, `npx cap sync` regenerates it and would drop a manual entry).
//
//  Wired in Base.lproj/Main.storyboard: the bridge scene's view controller
//  customClass was changed from Capacitor's own `CAPBridgeViewController` to
//  this subclass.
//

import UIKit
import Capacitor

class AppViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        // WebKit's OWN back-forward swipe gesture. Off by default in a
        // WKWebView, and Capacitor exposes no setting for it — so the app
        // silently LOST this when it moved from a PWA into a native shell, and
        // nobody noticed which piece had gone. In Safari / an installed PWA it
        // is on for free, which is why navigation felt right back then: that
        // was Apple's implementation, with real page snapshots and
        // compositor-level parallax.
        //
        // Every JS attempt since (`native-transitions.tsx`, and the snapshot
        // layer that ghosted in build 10) has been an imitation of a browser-
        // engine feature we already owned. Turning it back on beats
        // reimplementing it.
        //
        // CAVEAT, and the reason build 12 exists: this drives off WebKit's
        // back-forward list, and this app navigates by pushState. WebKit does
        // track those entries, but same-document navigation is where its
        // snapshotting is least reliable. Device-verified or reverted — not
        // assumed.
        webView?.allowsBackForwardNavigationGestures = true

        bridge?.registerPluginInstance(SharedAuthPlugin())
        // Lets the web layer suspend the gesture above while a drawer is open —
        // see WebViewGesturePlugin for why that guard is required.
        bridge?.registerPluginInstance(WebViewGesturePlugin())
        bridge?.registerPluginInstance(LiveActivityPlugin())
        let calendarBridge = CalendarBridgePlugin()
        bridge?.registerPluginInstance(calendarBridge)
        // Headless native smoke (simulator gate): `simctl launch … -smokeCalendar`
        // auto-presents the calendar sheet through the production path so a
        // screenshot proves it alive before a build ships. Inert otherwise —
        // the build-4 field crash (EventKitUI init off-main) shipped because
        // no gate ever EXECUTED this Swift, only compiled it.
        // `-smokeCalendarAllDay` covers the "time tbd" movie-night path, whose
        // whole point is that it must NOT write a timed block. Checked first:
        // it is the more specific flag, and both are inert otherwise.
        if ProcessInfo.processInfo.arguments.contains("-smokeCalendarAllDay") {
            DispatchQueue.main.asyncAfter(deadline: .now() + 6) {
                calendarBridge.smokePresent(allDay: true)
            }
        } else if ProcessInfo.processInfo.arguments.contains("-smokeCalendar") {
            DispatchQueue.main.asyncAfter(deadline: .now() + 6) {
                calendarBridge.smokePresent()
            }
        }
    }
}
