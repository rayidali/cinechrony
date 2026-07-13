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
    }
}
