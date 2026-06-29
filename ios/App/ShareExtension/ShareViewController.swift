//
//  ShareViewController.swift
//  Cinechrony Share Extension (Phase C.3)
//
//  The native doorway: from TikTok / Instagram / YouTube, the user taps
//  Share → Cinechrony and lands in the in-app extractor.
//
//  DESIGN (thin, fast, never-lose-a-share capture-and-forward):
//   1. Robustly pull the first http(s) URL out of whatever was shared — a URL
//      attachment, plain text containing a link, or the item's content text.
//      We do ZERO network/auth here (the extension is sandboxed, memory-limited,
//      short-lived); all real work happens in the authenticated main app.
//   2. DURABLE: append the URL to a shared App Group queue in the SAME format
//      @capacitor/preferences reads, so the main app can drain it even if the
//      hand-off open fails (the redundancy net — a share is never lost).
//   3. PRIMARY: open the host app deep link `cinechrony://extract?url=…`
//      (official extensionContext.open first, responder-chain fallback).
//   4. Complete the request quickly so iOS never kills us mid-flight.
//
//  Built on the wizard's SLComposeServiceViewController template so NO storyboard
//  or extra Xcode wiring is needed — we just skip the compose UI and act on
//  appearance. Constants below MUST match Xcode config (App Group + URL scheme).
//

import UIKit
import Social
import UniformTypeIdentifiers
import ObjectiveC

class ShareViewController: SLComposeServiceViewController {

    // MARK: - Config (must match Xcode / Info.plist)
    private let appGroupId = "group.com.cinechrony.app"
    private let appScheme  = "cinechrony"
    private let pendingKey = "cc_pending_shares" // stored as "CapacitorStorage.cc_pending_shares"

    private var didComplete = false

    // We don't use the compose box — do the work as soon as the sheet appears.
    override func presentationAnimationDidFinish() {
        super.presentationAnimationDidFinish()

        // Hard safety net: a share extension must never hang the share sheet.
        DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self] in self?.finish() }

        resolveSharedURL { [weak self] url in
            guard let self = self else { return }
            if let url = url {
                self.saveToAppGroup(url)   // 1) durable — never lose the share
                self.openHostApp(url)      // 2) primary — wake the app into /extract
            } else {
                self.finish()
            }
        }
    }

    // SLComposeServiceViewController plumbing (we auto-complete, so these are no-ops).
    override func isContentValid() -> Bool { return true }
    override func didSelectPost() { finish() }
    override func configurationItems() -> [Any]! { return [] }

    // MARK: - URL resolution (robust across every way a URL can arrive)

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

    // MARK: - Durable hand-off (App Group queue, @capacitor/preferences format)

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

    // MARK: - Primary hand-off (open the app)

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
