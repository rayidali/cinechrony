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
        bridge?.registerPluginInstance(SharedAuthPlugin())
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
