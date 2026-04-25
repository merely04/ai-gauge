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

struct ConfigErrorPayload: Decodable {
    let type: String
    let key: String
    let value: AnyCodableValue?
    let reason: String
}

struct AnyCodableValue: Decodable {
    let stringValue: String

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let s = try? container.decode(String.self) {
            stringValue = s
        } else if let b = try? container.decode(Bool.self) {
            stringValue = String(b)
        } else if let i = try? container.decode(Int.self) {
            stringValue = String(i)
        } else if let d = try? container.decode(Double.self) {
            stringValue = String(d)
        } else {
            stringValue = ""
        }
    }
}

struct TypedMessage: Decodable {
    let type: String
}
