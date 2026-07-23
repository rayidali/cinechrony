//
//  ExtensionAPI.swift
//  Cinechrony Share Extension (Phase C.3 — Corner-style in-place drawer)
//
//  All networking for the extension: reads the shared-keychain credential,
//  exchanges the refresh token for a fresh Firebase ID token, and calls the
//  same `/api/v1/*` endpoints the web app's extraction flow uses
//  (src/app/extract/client.tsx). Plain URLSession + async/await — no
//  third-party dependencies (the extension doesn't (and can't cheaply) link
//  the Capacitor/Firebase SPM graph the App target uses).
//
//  An `actor` so the cached credential/ID-token state can't race across the
//  handful of concurrent calls a single flow makes (e.g. a poll tick landing
//  while the user opens the list picker).
//

import Foundation

enum APIError: Error {
    case noCredential
    case unauthorized
    case http(Int)
    case decode
    case badURL
    case server(String)
    /// `QUOTA_EXCEEDED` (429) — the weekly free-scan quota is spent. Distinct
    /// from `.server` so the drawer can render an inline "come back monday"
    /// state instead of the generic error state.
    case quotaExceeded(String)
}

actor ExtensionAPI {
    // Flips to app.cinechrony.com later (see PHASE-B-HANDOFF.md §9 — the app
    // repo's own api-client.ts resolves this the same way via
    // NEXT_PUBLIC_API_BASE_URL; the extension has no build-time env
    // injection, so the origin is a plain constant here).
    private let apiBase = "https://movienight-kappa.vercel.app"

    private var credential: SharedCredential?
    private var cachedIdToken: String?

    /// Loads the shared credential from the keychain. Returns false when
    /// there's nothing to authenticate with (→ the signed-out state).
    func loadCredential() -> Bool {
        credential = ExtensionKeychain.read()
        return credential != nil
    }

    func credentialUid() -> String? {
        credential?.uid
    }

    // MARK: - Token exchange (Firebase's public secure-token REST endpoint)

    private func exchangeToken(forceRefresh: Bool) async throws -> String {
        if let cachedIdToken, !forceRefresh { return cachedIdToken }
        guard let credential else { throw APIError.noCredential }

        guard let url = URL(string: "https://securetoken.googleapis.com/v1/token?key=\(credential.apiKey)") else {
            throw APIError.badURL
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        let encodedRefresh = credential.refreshToken.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? credential.refreshToken
        request.httpBody = "grant_type=refresh_token&refresh_token=\(encodedRefresh)".data(using: .utf8)

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.http(0) }
        guard (200..<300).contains(http.statusCode) else {
            // A bad/expired refresh token surfaces here as 400 — treat as signed-out.
            throw http.statusCode == 400 ? APIError.unauthorized : APIError.http(http.statusCode)
        }

        let decoded: TokenExchangeResponse
        do {
            decoded = try JSONDecoder().decode(TokenExchangeResponse.self, from: data)
        } catch {
            throw APIError.decode
        }

        cachedIdToken = decoded.idToken
        // Google occasionally rotates the refresh token on exchange — persist
        // it so the NEXT share (a fresh extension process) still works.
        if let rotated = decoded.refreshToken, rotated != credential.refreshToken {
            var updated = credential
            updated.refreshToken = rotated
            self.credential = updated
            ExtensionKeychain.write(updated)
        }
        return decoded.idToken
    }

    // MARK: - Generic authed request (retries once on 401 after a forced refresh)

    private func authedRequest<T: Decodable>(
        _ path: String,
        method: String = "GET",
        body: Data? = nil,
        retrying: Bool = false
    ) async throws -> T {
        guard credential != nil else { throw APIError.noCredential }
        let token = try await exchangeToken(forceRefresh: retrying)

        guard let url = URL(string: apiBase + path) else { throw APIError.badURL }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.http(0) }

        if http.statusCode == 401 {
            if !retrying {
                return try await authedRequest(path, method: method, body: body, retrying: true)
            }
            throw APIError.unauthorized
        }

        let envelope: APIEnvelope<T>
        do {
            envelope = try JSONDecoder().decode(APIEnvelope<T>.self, from: data)
        } catch {
            throw APIError.decode
        }

        if envelope.ok, let value = envelope.data {
            return value
        }
        if envelope.error?.code == "QUOTA_EXCEEDED" {
            throw APIError.quotaExceeded(envelope.error?.message ?? "you're out of scans this week. they refresh monday.")
        }
        throw APIError.server(envelope.error?.message ?? "Request failed (HTTP \(http.statusCode))")
    }

    // MARK: - Endpoints (mirror src/app/extract/client.tsx exactly)

    func createExtraction(url: String) async throws -> CreateJobResponse {
        let body = try JSONEncoder().encode(["url": url])
        return try await authedRequest("/api/v1/extractions", method: "POST", body: body)
    }

    func getExtraction(jobId: String) async throws -> ExtractionJobDTO {
        try await authedRequest("/api/v1/extractions/\(jobId)")
    }

    func getLists() async throws -> [ListSummaryDTO] {
        let res: ListsResponse = try await authedRequest("/api/v1/lists")
        return res.lists
    }

    /// Lists shared WITH the caller (collaborator) — so the picker matches the
    /// in-app one and films can land in a friend's list.
    func getSharedLists() async throws -> [SharedListDTO] {
        let res: SharedListsResponse = try await authedRequest("/api/v1/me/collaborative-lists")
        return res.lists
    }

    func saveExtraction(jobId: String, body: SaveBody) async throws -> SaveResponseDTO {
        let data = try JSONEncoder().encode(body)
        return try await authedRequest("/api/v1/extractions/\(jobId)/save", method: "POST", body: data)
    }

    /// Best-effort, fire-and-forget: the drawer is closing while the scan is
    /// still running. Clears the server's live-watcher stamp so the completion
    /// push fires instead of being suppressed by our own recent poll.
    func detach(jobId: String) async {
        struct DetachResponse: Decodable { let detached: Bool? }
        let _: DetachResponse? = try? await authedRequest("/api/v1/extractions/\(jobId)/detach", method: "POST")
    }
}
