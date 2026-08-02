//
//  WebViewGesturePlugin.swift
//  Cinechrony — lets the web layer suspend WebKit's back-forward swipe.
//
//  WHY THIS EXISTS. Build 12 turned on `allowsBackForwardNavigationGestures`,
//  which restored the real iOS back gesture the app had as a PWA and lost in
//  the Capacitor wrap. It was the right fix, but it silently dropped a guard.
//
//  The JS gesture it replaced (`native-transitions.tsx`) refused to start
//  whenever a covering overlay sat over the page — `coveredByFixedOverlay()`.
//  WebKit's gesture has no idea Vaul drawers exist, so it will happily pop the
//  route out from under an OPEN sheet. Vaul scroll-locks the page while a
//  drawer is up (`body { position: fixed; top: -<scrollY>px }`) and restores it
//  in an unmount cleanup; navigate mid-flight and that restore never runs. The
//  user is left on a page whose content has scrolled out of view, with only the
//  `position: fixed` chrome — bottom nav and FAB — still visible. That is the
//  exact symptom `body-style-watchdog.tsx` was written for, reached by a new
//  route.
//
//  So the web layer toggles the gesture off while any drawer is mounted and
//  back on when the last one closes — restoring the guard we lost, rather than
//  cleaning up after a state we could have prevented.
//
//  HARD-LEARNED RULE (build 4 crashed in the field on this): Capacitor invokes
//  plugin methods on a BACKGROUND queue. `webView` is UIKit. Hop to main before
//  touching it — no exceptions, and that includes a property write.
//

import Foundation
import Capacitor

@objc(WebViewGesturePlugin)
public class WebViewGesturePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WebViewGesturePlugin"
    public let jsName = "WebViewGesture"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(#selector(setBackSwipeEnabled(_:)), returnType: .promise)
    ]

    @objc func setBackSwipeEnabled(_ call: CAPPluginCall) {
        // Default TRUE: if the web layer ever calls this malformed, fail back to
        // the gesture being available. A missing back gesture is a regression a
        // user feels immediately; an extra one is recoverable.
        let enabled = call.getBool("enabled") ?? true
        DispatchQueue.main.async { [weak self] in
            self?.webView?.allowsBackForwardNavigationGestures = enabled
            call.resolve(["enabled": enabled])
        }
    }
}
