//
//  ShareViewController.swift
//  Cinechrony Share Extension (Phase C.3)
//
//  The native doorway: from TikTok / Instagram / YouTube, the user taps
//  Share → Cinechrony and lands in the in-app extractor.
//
//  DESIGN (thin, fast, never-lose-a-share capture-and-forward):
//   1. Robustly pull the first http(s) URL out of whatever was shared — a
//      `public.url` attachment, plain text containing a link, or the item's
//      content text. We do ZERO network/auth here (the extension is sandboxed,
//      memory-limited, and short-lived); all real work happens in the main app.
//   2. DURABLE: append the URL to an App Group queue in the SAME format
//      `@capacitor/preferences` reads, so the main app can drain it even if the
//      hand-off open fails (the redundancy net — a share is never lost).
//   3. PRIMARY: open the host app deep link `cinechrony://extract?url=…`
//      (official `extensionContext.open` first, responder-chain fallback).
//   4. Complete the request quickly so iOS never kills us mid-flight.
//
//  Constants below MUST match Xcode config:
//   - appGroupId  → the App Group on BOTH the app target and this extension
//   - appScheme   → a CFBundleURLScheme registered on the MAIN app
//

import UIKit
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {

    // MARK: - Config (must match Xcode / Info.plist)
    private let appGroupId = "group.com.cinechrony.app"
    private let appScheme  = "cinechrony"
    private let pendingKey = "cc_pending_shares" // stored as "CapacitorStorage.cc_pending_shares"

    // MARK: - UI
    private let card = UIView()
    private let spinner = UIActivityIndicatorView(style: .medium)
    private let label = UILabel()

    // MARK: - State
    private var didComplete = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor.black.withAlphaComponent(0.18)
        buildCard()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)

        // Hard safety net: a share extension must never hang the share sheet.
        DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self] in
            self?.complete(message: "Couldn’t read that. Try again.", delay: 0.8)
        }

        resolveSharedURL { [weak self] url in
            guard let self = self else { return }
            guard let url = url else {
                self.complete(message: "No link found to scan.", delay: 1.0)
                return
            }
            self.saveToAppGroup(url)   // 1) durable — never lose the share
            self.openHostApp(url)      // 2) primary — wake the app into /extract
        }
    }

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

        // Resolve when all attachments report back; the timeout above is the backstop.
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
        guard let deepLink = makeDeepLink(for: url) else {
            complete(message: "Saved to Cinechrony", delay: 0.5)
            return
        }
        // Official path first; responder-chain fallback if the OS declines it.
        extensionContext?.open(deepLink) { [weak self] opened in
            DispatchQueue.main.async {
                if !opened { _ = self?.openViaResponderChain(deepLink) }
                self?.complete(message: "Opening Cinechrony…", delay: 0.3)
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
        let selector = sel_registerName("openURL:")
        var responder: UIResponder? = self
        while let current = responder {
            if current.responds(to: selector) {
                _ = current.perform(selector, with: url)
                return true
            }
            responder = current.next
        }
        return false
    }

    // MARK: - Completion (idempotent)

    private func complete(message: String, delay: TimeInterval) {
        guard !didComplete else { return }
        didComplete = true
        DispatchQueue.main.async { [weak self] in
            self?.spinner.stopAnimating()
            self?.label.text = message
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
            self?.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
        }
    }

    // MARK: - Minimal confirmation UI (no compose box)

    private func buildCard() {
        card.backgroundColor = UIColor.systemBackground
        card.layer.cornerRadius = 18
        card.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(card)

        spinner.startAnimating()
        spinner.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(spinner)

        label.text = "Adding to Cinechrony…"
        label.font = .systemFont(ofSize: 15, weight: .semibold)
        label.textColor = .label
        label.numberOfLines = 2
        label.textAlignment = .center
        label.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(label)

        NSLayoutConstraint.activate([
            card.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            card.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            card.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 40),
            card.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -40),
            card.widthAnchor.constraint(greaterThanOrEqualToConstant: 220),

            spinner.topAnchor.constraint(equalTo: card.topAnchor, constant: 22),
            spinner.centerXAnchor.constraint(equalTo: card.centerXAnchor),

            label.topAnchor.constraint(equalTo: spinner.bottomAnchor, constant: 14),
            label.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 20),
            label.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -20),
            label.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -22),
        ])
    }
}
