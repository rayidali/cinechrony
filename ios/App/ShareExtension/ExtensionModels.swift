//
//  ExtensionModels.swift
//  Cinechrony Share Extension (Phase C.3 — Corner-style in-place drawer)
//
//  Small, dependency-free Codable types mirroring the wire shapes the web
//  client already uses (src/lib/extraction-types.ts + the `/api/v1/lists` and
//  `/api/v1/extractions/**` route handlers). Kept deliberately small — the
//  extension has a tight memory budget, so these are plain value types with no
//  extra derived state.
//

import Foundation

// MARK: - Envelope (matches src/lib/api-client.ts: { ok, data } | { ok:false, error })

struct APIEnvelope<T: Decodable>: Decodable {
    let ok: Bool
    let data: T?
    let error: APIEnvelopeError?
}

struct APIEnvelopeError: Decodable {
    let code: String?
    let message: String?
}

// MARK: - Shared credential (the keychain blob written by SharedAuthPlugin)

struct SharedCredential: Codable {
    var refreshToken: String
    var apiKey: String
    var uid: String
}

// MARK: - Firebase secure-token exchange (securetoken.googleapis.com)

struct TokenExchangeResponse: Decodable {
    let idToken: String
    let refreshToken: String?

    enum CodingKeys: String, CodingKey {
        case idToken = "id_token"
        case refreshToken = "refresh_token"
    }
}

// MARK: - Extraction job (mirrors ExtractionJobView / ExtractionFilm in extraction-types.ts)

struct CreateJobResponse: Decodable {
    let jobId: String
    let status: String
}

struct ExtractionEvidenceDTO: Decodable {
    let channel: String?
    let quote: String?
    let timestampSec: Double?
}

struct ExtractionFilmDTO: Decodable, Identifiable {
    let tmdbId: Int
    let title: String
    let year: String?
    let mediaType: String
    let posterUrl: String?
    let confidence: Double?
    let evidence: ExtractionEvidenceDTO?
    let imdbRating: String?

    var id: Int { tmdbId }
}

struct ExtractionJobDTO: Decodable {
    let jobId: String
    let status: String
    let stage: String
    let provider: String?
    let sourceUrl: String?
    let films: [ExtractionFilmDTO]?
    let suggestedListName: String?
    let isFilmContent: Bool?
    let videoThumbnail: String?
    let errorCode: String?
}

// MARK: - Lists (mirrors ListSummary in lists-server.ts — GET /api/v1/lists)

struct ListSummaryDTO: Decodable, Identifiable {
    let id: String
    let name: String
    let movieCount: Int?
    let isPublic: Bool?
    let coverImageUrl: String?
    let ownerId: String?
}

struct ListsResponse: Decodable {
    let lists: [ListSummaryDTO]
}

/// A list shared WITH the caller (collaborator) — GET /api/v1/me/collaborative-lists
/// (mirrors CollaborativeListSummary in lists-server.ts).
struct SharedListDTO: Decodable, Identifiable {
    let id: String
    let name: String
    let ownerId: String
    let isPublic: Bool?
    let coverImageUrl: String?
    let ownerUsername: String?
    let ownerDisplayName: String?
}

struct SharedListsResponse: Decodable {
    let lists: [SharedListDTO]
}

/// One row of the destination picker — own + shared lists, pre-labelled, so
/// the view stays dumb (mirrors the web ListPickerSheet's PickableList).
struct PickerListItem: Identifiable, Equatable {
    let id: String
    let ownerId: String
    let name: String
    let coverImageUrl: String?
    /// "private · 18 films" | "public · 14 films" | "shared by murt"
    let subtitle: String
}

// MARK: - Save (mirrors the EXACT body extract/client.tsx's save() sends to
// POST /api/v1/extractions/[jobId]/save, and its response shape)

struct CreateListSpec: Encodable {
    let tempId: String
    let name: String
}

/// Encodes only the keys that are actually present — `{tempId:"new"}` for a new
/// list, `{ownerId,listId}` for an existing one — matching the web client's
/// object-literal shape exactly (no stray `null` keys).
struct SaveTarget: Encodable {
    let tempId: String?
    let ownerId: String?
    let listId: String?

    enum CodingKeys: String, CodingKey { case tempId, ownerId, listId }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(tempId, forKey: .tempId)
        try container.encodeIfPresent(ownerId, forKey: .ownerId)
        try container.encodeIfPresent(listId, forKey: .listId)
    }
}

struct SaveItem: Encodable {
    let tmdbId: Int
    let mediaType: String
    let target: SaveTarget
}

struct SaveBody: Encodable {
    let createLists: [CreateListSpec]
    let items: [SaveItem]
}

struct SaveResultItem: Decodable {
    let tmdbId: Int?
    let ok: Bool
    let listId: String?
    let deduped: Bool?
    let error: String?
}

struct SaveResponseDTO: Decodable {
    let results: [SaveResultItem]
}
