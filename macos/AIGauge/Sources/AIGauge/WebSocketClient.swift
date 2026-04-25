import Foundation
import Combine

let AI_GAUGE_WS_URL = URL(string: "ws://localhost:19876")!

struct UsagePayload: Codable {
    struct Window: Codable {
        let utilization: Double?
        let resets_at: String?
    }

    struct ExtraUsage: Codable {
        let is_enabled: Bool?
        let utilization: Double?
        let used_credits: Double?
        let monthly_limit: Double?
    }

    struct Balance: Codable {
        let currency: String?
        let total_cents: Int?
        let used_cents: Int?
        let remaining_cents: Int?
        let percentage: Double?
    }

    struct Meta: Codable {
        let plan: String?
        let fetchedAt: String?
        let tokenSource: String?
        let version: String?
        let protocolVersion: Int?
        let autoCheckUpdates: Bool?
        let displayMode: String?
        let provider: String?
    }

    struct Secondary: Codable {
        let provider: String?
        let five_hour: Window?
        let seven_day: Window?
        let code_review: Window?
        let balance: Balance?
    }

    let five_hour: Window?
    let seven_day: Window?
    let seven_day_sonnet: Window?
    let code_review: Window?
    let extra_usage: ExtraUsage?
    let balance: Balance?
    let secondary: Secondary?
    let meta: Meta?
}

struct NotifyPayload: Codable {
    let type: String
    let threshold: Int
    let percentage: Int
    let message: String
}

struct DiscoveredSource: Codable, Identifiable, Equatable {
    var id: String { name }
    let name: String
    let provider: String
    let baseUrl: String?
    let hasToken: Bool
    let supported: Bool
    let skipReason: String?
}

struct SettingsFilesPayload: Decodable {
    let type: String
    let files: [DiscoveredSource]
}

final class WebSocketClient: ObservableObject, @unchecked Sendable {
    @Published var connected: Bool = false
    @Published var lastUsagePayload: UsagePayload?

    var onNotify: ((NotifyPayload) -> Void)?
    var onUsageUpdate: ((UsagePayload) -> Void)?
    var onUpdateAvailable: ((UpdateAvailablePayload) -> Void)?
    var onUpdateInstalling: ((UpdateInstallingPayload) -> Void)?
    var onUpdateFailed: ((UpdateFailedPayload) -> Void)?
    var onUpdateComplete: ((UpdateCompletePayload) -> Void)?
    var onUpdateCheckFailed: ((UpdateCheckFailedPayload) -> Void)?
    var onUpdateAlreadyInProgress: (() -> Void)?
    var onSettingsFiles: (([DiscoveredSource]) -> Void)?
    var onConnect: (() -> Void)?

    private let session: URLSession
    private let decoder = JSONDecoder()
    private var task: URLSessionWebSocketTask?
    private var receiveTask: Task<Void, Never>?
    private var backoffDelay: TimeInterval = 1.0

    init(session: URLSession = .shared) {
        self.session = session
    }

    func connect() {
        receiveTask?.cancel()
        task?.cancel(with: .goingAway, reason: nil)

        let task = session.webSocketTask(with: AI_GAUGE_WS_URL)
        self.task = task
        task.resume()

        receiveTask = Task { [weak self] in
            await self?.receiveLoop()
        }
    }

    func send(_ json: String) {
        guard let task else { return }

        Task {
            do {
                try await task.send(.string(json))
            } catch {
                self.log("[ws] disconnected\n")
                DispatchQueue.main.async {
                    self.connected = false
                }
                self.reconnectWithBackoff()
            }
        }
    }

    private func receiveLoop() async {
        guard let task else { return }

        do {
            let message = try await task.receive()
            backoffDelay = 1.0

            if !self.connected {
                DispatchQueue.main.async { self.connected = true }
                self.log("[ws] connected\n")
                DispatchQueue.main.async { self.onConnect?() }
            }

            switch message {
            case .string(let text):
                log("[ws] message\n")
                handleMessage(text)
            case .data(let data):
                log("[ws] message\n")
                if let text = String(data: data, encoding: .utf8) {
                    handleMessage(text)
                }
            @unknown default:
                break
            }

            await receiveLoop()
        } catch {
            log("[ws] disconnected\n")
            DispatchQueue.main.async {
                self.connected = false
            }
            reconnectWithBackoff()
        }
    }

    private func handleMessage(_ text: String) {
        guard let data = text.data(using: .utf8) else { return }

        // Peek at `type` to route update messages to their decoders before
        // falling through to notify / usage decoding.
        if let peek = try? decoder.decode(TypedMessage.self, from: data) {
            switch peek.type {
            case "updateAvailable":
                if let payload = try? decoder.decode(UpdateAvailablePayload.self, from: data) {
                    DispatchQueue.main.async { self.onUpdateAvailable?(payload) }
                    return
                }
            case "updateInstalling":
                if let payload = try? decoder.decode(UpdateInstallingPayload.self, from: data) {
                    DispatchQueue.main.async { self.onUpdateInstalling?(payload) }
                    return
                }
            case "updateFailed":
                if let payload = try? decoder.decode(UpdateFailedPayload.self, from: data) {
                    DispatchQueue.main.async { self.onUpdateFailed?(payload) }
                    return
                }
            case "updateComplete":
                if let payload = try? decoder.decode(UpdateCompletePayload.self, from: data) {
                    DispatchQueue.main.async { self.onUpdateComplete?(payload) }
                    return
                }
            case "updateCheckFailed":
                if let payload = try? decoder.decode(UpdateCheckFailedPayload.self, from: data) {
                    DispatchQueue.main.async { self.onUpdateCheckFailed?(payload) }
                    return
                }
            case "updateAlreadyInProgress":
                DispatchQueue.main.async { self.onUpdateAlreadyInProgress?() }
                return
            case "settingsFiles":
                if let payload = try? decoder.decode(SettingsFilesPayload.self, from: data) {
                    DispatchQueue.main.async { self.onSettingsFiles?(payload.files) }
                    return
                }
            case "notify":
                break
            default:
                break
            }
        }

        // Notify payload has a "type" field — try it first so raw usage data
        // (which never has `type`) doesn't accidentally match.
        if let notify = try? decoder.decode(NotifyPayload.self, from: data), notify.type == "notify" {
            DispatchQueue.main.async {
                self.onNotify?(notify)
            }
            return
        }

        if let usage = try? decoder.decode(UsagePayload.self, from: data), usage.meta != nil {
            DispatchQueue.main.async {
                self.lastUsagePayload = usage
                self.onUsageUpdate?(usage)
            }
        }
    }

    func sendCheckUpdate() {
        send("{\"type\":\"checkUpdate\"}")
    }

    func sendDoUpdate() {
        send("{\"type\":\"doUpdate\"}")
    }

    func requestSettingsFiles() {
        send("{\"type\":\"listSettingsFiles\"}")
    }

    private func reconnectWithBackoff() {
        let delay = backoffDelay
        backoffDelay = min(backoffDelay * 2.0, 30.0)

        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
            self?.connect()
        }
    }

    private func log(_ message: String) {
        FileHandle.standardError.write(Data(message.utf8))
    }
}
