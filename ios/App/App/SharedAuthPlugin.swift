//
//  SharedAuthPlugin.swift
//  Cinechrony (Phase C.3 — Share Extension credential bridge)
//
//  A tiny local Capacitor plugin (no npm package — registered as a plugin
//  INSTANCE from AppViewController.capacitorDidLoad(), see that file). The web
//  app calls `set()` on sign-in and `clear()` on sign-out
//  (src/lib/shared-auth.ts, wired from src/firebase/provider.tsx's central
//  onAuthStateChanged observer) to write/erase a refreshable Firebase
//  credential in the SHARED keychain — the access group is a sibling of the
//  App Group (group.com.cinechrony.shared) used for the share-extension queue.
//
//  Why: the Share Extension runs as a separate, sandboxed process with no
//  access to the host app's in-memory Firebase session. The only durable,
//  secure channel between the two is a Keychain item in a shared access
//  group. Storing the REFRESH token (not a short-lived ID token) means the
//  extension can mint its own fresh ID tokens for as long as the user stays
//  signed in — it exchanges the refresh token for an ID token itself via
//  Google's securetoken endpoint (see ShareExtension/ExtensionAPI.swift).
//
//  One keychain item, JSON blob: {refreshToken, apiKey, uid}.
//

import Foundation
import Capacitor
import Security

@objc(SharedAuthPlugin)
public class SharedAuthPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SharedAuthPlugin"
    public let jsName = "SharedAuth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(#selector(set(_:)), returnType: .promise),
        CAPPluginMethod(#selector(clear(_:)), returnType: .promise),
    ]

    // MARK: - Keychain item spec (MUST match ShareExtension/ExtensionKeychain.swift)
    private let service = "com.cinechrony.sharedauth"
    private let account = "credential"
    // Resolved App Identifier Prefix (= Team ID, see App.entitlements'
    // `$(AppIdentifierPrefix)com.cinechrony.app`) — hardcoded because neither
    // target can read its own resolved entitlement value at runtime as a
    // plain string; both DEVELOPMENT_TEAM settings in project.pbxproj are
    // GBR6GTFYCL, so this is stable as long as the team doesn't change.
    private let accessGroup = "GBR6GTFYCL.com.cinechrony.app"

    private func baseQuery() -> [String: Any] {
        return [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrAccessGroup as String: accessGroup,
        ]
    }

    @objc func set(_ call: CAPPluginCall) {
        guard
            let refreshToken = call.getString("refreshToken"), !refreshToken.isEmpty,
            let apiKey = call.getString("apiKey"), !apiKey.isEmpty,
            let uid = call.getString("uid"), !uid.isEmpty
        else {
            call.reject("refreshToken, apiKey, and uid are required")
            return
        }

        let payload: [String: String] = ["refreshToken": refreshToken, "apiKey": apiKey, "uid": uid]
        guard let data = try? JSONSerialization.data(withJSONObject: payload) else {
            call.reject("Failed to encode credential")
            return
        }

        // Overwrite semantics: delete any existing item, then add fresh. Simplest
        // way to guarantee the stored blob always matches the latest sign-in,
        // without worrying about SecItemUpdate's separate query/attributes split.
        SecItemDelete(baseQuery() as CFDictionary)

        var addQuery = baseQuery()
        addQuery[kSecValueData as String] = data
        addQuery[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock

        let status = SecItemAdd(addQuery as CFDictionary, nil)
        if status == errSecSuccess {
            call.resolve()
        } else {
            call.reject("Keychain write failed (OSStatus \(status))")
        }
    }

    @objc func clear(_ call: CAPPluginCall) {
        let status = SecItemDelete(baseQuery() as CFDictionary)
        if status == errSecSuccess || status == errSecItemNotFound {
            call.resolve()
        } else {
            call.reject("Keychain clear failed (OSStatus \(status))")
        }
    }
}
