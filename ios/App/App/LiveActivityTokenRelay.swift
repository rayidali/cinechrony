//
//  LiveActivityTokenRelay.swift
//  Cinechrony — ships ActivityKit's two token streams to the backend
//  NATIVELY, from the earliest moment of app launch.
//
//  Why this exists (evidence-driven): when the server push-to-starts the
//  scan tracker while the app isn't running, iOS launches the app in the
//  BACKGROUND so it can observe the new activity. In that window the
//  Capacitor WebView may boot slowly or get suspended before the JS bridge
//  (live-activity-native.ts) ships the activity's UPDATE token — observed in
//  prod: the card started instantly, the push-to-start token re-registered,
//  but `updateToken` never reached the job doc, so the card froze on stage 1
//  while the drawer raced ahead. This relay removes the WebView from the
//  critical path entirely: pure Swift observers start in
//  didFinishLaunching, and uploads authenticate exactly the way the share
//  extension does — the shared-keychain refresh token minted into a fresh
//  ID token via securetoken. The JS path stays as redundancy; the server
//  endpoints are idempotent, so double delivery is harmless.
//

import Foundation
import Security
import UIKit
#if canImport(ActivityKit)
import ActivityKit
#endif

enum LiveActivityTokenRelay {

    // Mirrors ExtensionAPI.swift — the extension has no build-time env either.
    private static let apiBase = "https://movienight-kappa.vercel.app"
    // MUST match SharedAuthPlugin.swift / ExtensionKeychain.swift.
    private static let keychainService = "com.cinechrony.sharedauth"
    private static let keychainAccount = "credential"
    private static let accessGroup = "GBR6GTFYCL.com.cinechrony.app"

    private static var started = false
    /// Touched only from the single sequential observer Task — no lock needed.
    private static var observedActivityIds = Set<String>()
    private static var cachedIdToken: (token: String, mintedAt: Date)?

    /// Idempotent. Called from AppDelegate.didFinishLaunching — including the
    /// background launch iOS performs for a push-started Live Activity.
    static func start() {
        guard !started else { return }
        started = true
        guard #available(iOS 17.2, *) else { return }

        Task {
            for await tokenData in Activity<ScanActivityAttributes>.pushToStartTokenUpdates {
                await upload(path: "/api/v1/me/live-activity-token",
                             body: ["deviceId": nativeDeviceId(), "token": hex(tokenData)])
            }
        }
        Task {
            for activity in Activity<ScanActivityAttributes>.activities {
                observe(activity)
            }
            for await activity in Activity<ScanActivityAttributes>.activityUpdates {
                observe(activity)
            }
        }
    }

    @available(iOS 17.2, *)
    private static func observe(_ activity: Activity<ScanActivityAttributes>) {
        guard !observedActivityIds.contains(activity.id) else { return }
        observedActivityIds.insert(activity.id)

        if let tokenData = activity.pushToken {
            uploadUpdateToken(jobId: activity.attributes.jobId, activityId: activity.id, tokenData: tokenData)
        }
        Task {
            for await tokenData in activity.pushTokenUpdates {
                uploadUpdateToken(jobId: activity.attributes.jobId, activityId: activity.id, tokenData: tokenData)
            }
        }
    }

    @available(iOS 17.2, *)
    private static func uploadUpdateToken(jobId: String, activityId: String, tokenData: Data) {
        Task {
            await upload(path: "/api/v1/extractions/\(jobId)/live-activity-token",
                         body: ["activityId": activityId, "token": hex(tokenData)])
        }
    }

    // MARK: - Upload (3 attempts, backoff — the background window is short)

    private static func upload(path: String, body: [String: String]) async {
        for attempt in 0..<3 {
            if attempt > 0 { try? await Task.sleep(nanoseconds: UInt64(600_000_000 * attempt)) }
            guard let idToken = await mintIdToken() else { continue }
            guard let url = URL(string: apiBase + path),
                  let payload = try? JSONSerialization.data(withJSONObject: body) else { return }
            var req = URLRequest(url: url)
            req.httpMethod = "POST"
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.setValue("Bearer \(idToken)", forHTTPHeaderField: "Authorization")
            req.httpBody = payload
            do {
                let (_, res) = try await URLSession.shared.data(for: req)
                let status = (res as? HTTPURLResponse)?.statusCode ?? 0
                if (200..<300).contains(status) { return }
                if status == 401 { cachedIdToken = nil } // stale token → re-mint next attempt
            } catch {
                // network — retry
            }
        }
    }

    // MARK: - Auth (the share extension's exact pattern)

    private struct SharedCredential: Decodable {
        let refreshToken: String
        let apiKey: String
    }

    private static func readCredential() -> SharedCredential? {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount,
            kSecAttrAccessGroup as String: accessGroup,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var out: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess,
              let data = out as? Data,
              let cred = try? JSONDecoder().decode(SharedCredential.self, from: data) else { return nil }
        return cred
    }

    private static func mintIdToken() async -> String? {
        if let cached = cachedIdToken, Date().timeIntervalSince(cached.mintedAt) < 45 * 60 {
            return cached.token
        }
        guard let cred = readCredential(),
              let url = URL(string: "https://securetoken.googleapis.com/v1/token?key=\(cred.apiKey)") else { return nil }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        req.httpBody = "grant_type=refresh_token&refresh_token=\(cred.refreshToken)".data(using: .utf8)
        struct TokenResponse: Decodable { let id_token: String }
        do {
            let (data, res) = try await URLSession.shared.data(for: req)
            guard (res as? HTTPURLResponse)?.statusCode == 200,
                  let parsed = try? JSONDecoder().decode(TokenResponse.self, from: data) else { return nil }
            cachedIdToken = (parsed.id_token, Date())
            return parsed.id_token
        } catch {
            return nil
        }
    }

    // MARK: - Helpers

    private static func nativeDeviceId() -> String {
        "native-\(UIDevice.current.identifierForVendor?.uuidString ?? "unknown-device")"
    }

    private static func hex(_ data: Data) -> String {
        data.map { String(format: "%02x", $0) }.joined()
    }
}
