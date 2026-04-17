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

    struct Meta: Codable {
        let plan: String?
        let fetchedAt: String?
    }

    let five_hour: Window?
    let seven_day: Window?
    let seven_day_sonnet: Window?
    let extra_usage: ExtraUsage?
    let meta: Meta?
}

struct NotifyPayload: Codable {
    let type: String
    let threshold: Int
    let percentage: Int
    let message: String
}

final class WebSocketClient: ObservableObject, @unchecked Sendable {
    @Published var connected: Bool = false
    @Published var lastUsagePayload: UsagePayload?

    var onNotify: ((NotifyPayload) -> Void)?
    var onUsageUpdate: ((UsagePayload) -> Void)?

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

        // Notify payload has a "type" field — try it first so raw usage data
        // (which never has `type`) doesn't accidentally match.
        if let notify = try? decoder.decode(NotifyPayload.self, from: data), notify.type == "notify" {
            DispatchQueue.main.async {
                self.onNotify?(notify)
            }
            return
        }

        if let usage = try? decoder.decode(UsagePayload.self, from: data), usage.five_hour != nil {
            DispatchQueue.main.async {
                self.lastUsagePayload = usage
                self.onUsageUpdate?(usage)
            }
        }
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
