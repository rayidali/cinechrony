//
//  ShareViewController.swift
//  Cinechrony Share Extension (Phase C.3 — Corner-style in-place drawer)
//
//  The native doorway: from TikTok / Instagram / YouTube, the user taps
//  Share → Cinechrony and a drawer slides up RIGHT THERE — the scan runs
//  in-place (narrated progress), films appear, the user picks a destination
//  and saves, the drawer closes. The host app does NOT open in the happy
//  path; a completion push (server-side) is the safety net if the user closes
//  early.
//
//  DESIGN:
//   1. Robustly pull the first http(s) URL out of whatever was shared — a URL
//      attachment, plain text containing a link, or the item's content text.
//      Zero network/auth here — this part is UNCHANGED from the original
//      bounce-to-app flow.
//   2. DURABLE: append the URL to the shared App Group queue in the SAME
//      format @capacitor/preferences reads (UNCHANGED) — belt-and-braces even
//      though the happy path never needs it: if the user backgrounds the host
//      app mid-scan and the completion push is somehow missed, the app still
//      picks the URL up on next foreground.
//   3. Present a UIHostingController wrapping ShareFlowView — the SwiftUI
//      drawer that does the scanning/saving over URLSession
//      (ExtensionAPI.swift), authenticated via the shared keychain
//      (ExtensionKeychain.swift / the App target's SharedAuthPlugin).
//   4. Opening the host app (`cinechrony://extract?url=…`) is now RARE — only
//      reachable from the drawer's signed-out/error states via "open
//      cinechrony". See ShareFlowModel.onOpenApp.
//
//  Plain UIViewController (NOT SLComposeServiceViewController — that class's
//  built-in compose chrome is the wrong shape for a full custom drawer) set as
//  NSExtensionPrincipalClass in Info.plist (no storyboard). Constants below
//  MUST match Xcode config (App Group + URL scheme) — see PHASE-C-SHARE-EXTENSION.md.
//

import UIKit
import SwiftUI
import UniformTypeIdentifiers
import ObjectiveC

class ShareViewController: UIViewController {

    // MARK: - Config (must match Xcode / Info.plist / the app's deep-link setup)
    private let appGroupId = "group.com.cinechrony.shared"
    private let appScheme  = "cinechrony"
    private let pendingKey = "cc_pending_shares" // stored as "CapacitorStorage.cc_pending_shares"

    private var didComplete = false
    private var hostingController: UIHostingController<ShareFlowView>?

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .clear

        var handled = false
        let handleResolvedURL: (URL?) -> Void = { [weak self] url in
            guard !handled else { return }
            handled = true
            guard let self else { return }
            guard let url else {
                // Nothing to scan (a share with no link at all) — there's
                // nothing the drawer could do, so close quietly. Zero
                // network/auth happened, so there's nothing to clean up.
                self.finish()
                return
            }
            self.saveToAppGroup(url) // durable belt-and-braces (see header)
            self.presentFlow(for: url)
        }

        // Hard safety net: if URL resolution never calls back (a misbehaving
        // share source), don't leave the user staring at a blank transparent
        // screen forever. No-ops once real resolution already handled it.
        DispatchQueue.main.asyncAfter(deadline: .now() + 8) { handleResolvedURL(nil) }

        resolveSharedURL { url in handleResolvedURL(url) }
    }

    private func presentFlow(for url: URL) {
        let model = ShareFlowModel(sharedURL: url)
        model.onFinish = { [weak self] in self?.finish() }
        model.onOpenApp = { [weak self] url in self?.openHostApp(url) }

        let hosting = UIHostingController(rootView: ShareFlowView(model: model))
        hosting.view.backgroundColor = .clear
        addChild(hosting)
        hosting.view.frame = view.bounds
        hosting.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(hosting.view)
        hosting.didMove(toParent: self)
        hostingController = hosting

        model.start()
    }

    // MARK: - URL resolution (robust across every way a URL can arrive) — UNCHANGED

    private func resolveSharedURL(completion: @escaping (URL?) -> Void) {
        let items = (extensionContext?.inputItems as? [NSExtensionItem]) ?? []
        var providers: [NSItemProvider] = []
        for item in items { providers.append(contentsOf: item.attachments ?? []) }

        let group = DispatchGroup()
        let lock = NSLock()
        var found: URL?
        func consider(_ candidate: URL?) {
            guard let u = candidate, (u.scheme == "http" || u.scheme == "https") else { return }
            lock.lock(); if found == nil { found = u }; lock.unlock()
        }

        let urlType = UTType.url.identifier
        let textTypes = [UTType.plainText.identifier, UTType.text.identifier]

        for provider in providers {
            if provider.hasItemConformingToTypeIdentifier(urlType) {
                group.enter()
                provider.loadItem(forTypeIdentifier: urlType, options: nil) { data, _ in
                    if let u = data as? URL { consider(u) }
                    else if let s = data as? String { consider(URL(string: s)) }
                    else if let d = data as? Data, let s = String(data: d, encoding: .utf8) { consider(URL(string: s)) }
                    group.leave()
                }
                continue
            }
            for textType in textTypes where provider.hasItemConformingToTypeIdentifier(textType) {
                group.enter()
                provider.loadItem(forTypeIdentifier: textType, options: nil) { data, _ in
                    if let s = data as? String { consider(self.firstURL(in: s)) }
                    else if let d = data as? Data, let s = String(data: d, encoding: .utf8) { consider(self.firstURL(in: s)) }
                    group.leave()
                }
                break
            }
        }

        // Some apps put the link in the item's content text rather than an attachment.
        for item in items {
            if let text = item.attributedContentText?.string { consider(firstURL(in: text)) }
        }

        group.notify(queue: .main) { completion(found) }
    }

    /// First link inside free text (handles "check this out https://… 🔥").
    private func firstURL(in text: String) -> URL? {
        guard let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue) else { return nil }
        let range = NSRange(text.startIndex..., in: text)
        return detector.firstMatch(in: text, options: [], range: range)?.url
    }

    // MARK: - Durable hand-off (App Group queue, @capacitor/preferences format) — UNCHANGED

    private func saveToAppGroup(_ url: URL) {
        guard let defaults = UserDefaults(suiteName: appGroupId) else { return }
        let key = "CapacitorStorage.\(pendingKey)"
        var queue: [[String: Any]] = []
        if let existing = defaults.string(forKey: key),
           let data = existing.data(using: .utf8),
           let parsed = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]] {
            queue = parsed
        }
        queue.append(["url": url.absoluteString, "ts": Date().timeIntervalSince1970])
        if queue.count > 20 { queue = Array(queue.suffix(20)) } // bounded — don't grow forever
        if let data = try? JSONSerialization.data(withJSONObject: queue),
           let json = String(data: data, encoding: .utf8) {
            defaults.set(json, forKey: key)
        }
    }

    // MARK: - Fallback hand-off — the ONLY app-open path (signed-out / error "open cinechrony")

    private func openHostApp(_ url: URL) {
        guard let deepLink = makeDeepLink(for: url) else { finish(); return }
        // Apple restricts opening the host app from a share extension. Two
        // best-effort attempts, in order of reliability:
        //   1) The sanctioned NSExtensionContext.open (works on some iOS versions
        //      for a custom-scheme URL that points at the containing app).
        //   2) Responder-chain open using the MODERN selector. iOS 17/18+ FORCE
        //      return false for the deprecated single-arg `openURL:`, so we must
        //      call `openURL:options:completionHandler:` on a real UIApplication.
        extensionContext?.open(deepLink) { [weak self] opened in
            guard let self = self else { return }
            if opened {
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { self.finish() }
                return
            }
            let fallback = self.openViaResponderChain(deepLink)
            DispatchQueue.main.asyncAfter(deadline: .now() + (fallback ? 1.5 : 0.3)) {
                self.finish()
            }
        }
    }

    private func makeDeepLink(for url: URL) -> URL? {
        var components = URLComponents()
        components.scheme = appScheme
        components.host = "extract"
        components.queryItems = [URLQueryItem(name: "url", value: url.absoluteString)]
        return components.url
    }

    @discardableResult
    private func openViaResponderChain(_ url: URL) -> Bool {
        // MODERN, non-deprecated selector. The single-arg `openURL:` is
        // force-failed by UIKit on iOS 17/18+ ("BUG IN CLIENT OF UIKIT … Force
        // returning false"), which is why the old code silently did nothing.
        let selector = NSSelectorFromString("openURL:options:completionHandler:")
        guard let appClass = NSClassFromString("UIApplication") else { return false }
        var responder: UIResponder? = self
        while let current = responder {
            if current.isKind(of: appClass), current.responds(to: selector) {
                // perform(_:with:) can't pass 3 args — call the IMP directly.
                typealias OpenURL = @convention(c)
                    (NSObject, Selector, NSURL, NSDictionary, Any?) -> Void
                guard let method = class_getInstanceMethod(appClass, selector) else {
                    return false
                }
                let imp = method_getImplementation(method)
                let call = unsafeBitCast(imp, to: OpenURL.self)
                call(current, selector, url as NSURL, NSDictionary(), nil)
                return true
            }
            responder = current.next
        }
        return false
    }

    // MARK: - Completion (idempotent)

    private func finish() {
        guard !didComplete else { return }
        didComplete = true
        extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
    }
}
