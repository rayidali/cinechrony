//
//  ExtensionKeychain.swift
//  Cinechrony Share Extension (Phase C.3 — Corner-style in-place drawer)
//
//  Reads (and, on refresh-token rotation, rewrites) the SAME keychain item the
//  App target's SharedAuthPlugin writes on sign-in
//  (ios/App/App/SharedAuthPlugin.swift). Keep the service/account/access-group
//  spec identical in both files — that's the entire contract between the two
//  targets.
//
//  ShareExtension.entitlements already grants this access group
//  (`keychain-access-groups: $(AppIdentifierPrefix)com.cinechrony.app`), so no
//  extra entitlement work is needed here.
//

import Foundation
import Security

enum ExtensionKeychain {
    private static let service = "com.cinechrony.sharedauth"
    private static let account = "credential"
    private static let accessGroup = "GBR6GTFYCL.com.cinechrony.app"

    private static func baseQuery() -> [String: Any] {
        return [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrAccessGroup as String: accessGroup,
        ]
    }

    static func read() -> SharedCredential? {
        var query = baseQuery()
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else { return nil }
        return try? JSONDecoder().decode(SharedCredential.self, from: data)
    }

    /// Overwrite semantics (delete + add), same as the App-side plugin — used
    /// when the extension itself rotates the refresh token during a token
    /// exchange (see ExtensionAPI.swift).
    @discardableResult
    static func write(_ credential: SharedCredential) -> Bool {
        guard let data = try? JSONEncoder().encode(credential) else { return false }

        SecItemDelete(baseQuery() as CFDictionary)

        var addQuery = baseQuery()
        addQuery[kSecValueData as String] = data
        addQuery[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock

        return SecItemAdd(addQuery as CFDictionary, nil) == errSecSuccess
    }
}
