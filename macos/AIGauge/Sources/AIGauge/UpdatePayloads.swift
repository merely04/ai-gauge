import Foundation

struct UpdateAvailablePayload: Decodable {
    let type: String
    let currentVersion: String?
    let latestVersion: String
    let changelogUrl: String?
}

struct UpdateInstallingPayload: Decodable {
    let type: String
    let latestVersion: String?
}

struct UpdateFailedPayload: Decodable {
    let type: String
    let reason: String
    let command: String?
    let clipboardCopied: Bool?
}

struct UpdateCompletePayload: Decodable {
    let type: String
    let installedVersion: String?
    let fromVersion: String?
}

struct UpdateCheckFailedPayload: Decodable {
    let type: String
    let reason: String
}

struct UpdateAlreadyInProgressPayload: Decodable {
    let type: String
}

struct TypedMessage: Decodable {
    let type: String
}
