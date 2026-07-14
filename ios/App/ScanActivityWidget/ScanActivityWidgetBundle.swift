//
//  ScanActivityWidgetBundle.swift
//  ScanActivityWidget — the WidgetKit extension hosting the lock-screen /
//  Dynamic Island scan tracker (LIVE-ACTIVITY-PLAN.md). Deployment target
//  16.2 (ActivityKit floor); in practice activities only ever exist on
//  17.2+ because the server starts them via push-to-start.
//

import SwiftUI
import WidgetKit

@main
struct ScanActivityWidgetBundle: WidgetBundle {
    var body: some Widget {
        ScanActivityLiveActivity()
    }
}
