import Foundation
import Combine

final class ConfigMutator: ObservableObject {
    private weak var webSocketClient: WebSocketClient?

    init(ws: WebSocketClient) {
        self.webSocketClient = ws
    }

    func setPlan(_ plan: String) {
        webSocketClient?.send("{\"type\":\"setConfig\",\"key\":\"plan\",\"value\":\"\(Self.escape(plan))\"}")
    }

    func setTokenSource(_ source: String) {
        guard UsageModel.isValidTokenSource(source) else {
            FileHandle.standardError.write(Data("[config] rejected invalid tokenSource\n".utf8))
            return
        }
        webSocketClient?.send("{\"type\":\"setConfig\",\"key\":\"tokenSource\",\"value\":\"\(Self.escape(source))\"}")
    }

    func setDisplayMode(_ mode: String) {
        webSocketClient?.send("{\"type\":\"setConfig\",\"key\":\"displayMode\",\"value\":\"\(Self.escape(mode))\"}")
    }

    func setAutoCheckUpdates(_ enabled: Bool) {
        // Server validates against `[true, false]` (boolean), so emit an
        // unquoted JSON literal rather than a string.
        webSocketClient?.send("{\"type\":\"setConfig\",\"key\":\"autoCheckUpdates\",\"value\":\(enabled ? "true" : "false")}")
    }

    func refresh() {
        webSocketClient?.send("{\"type\":\"refresh\"}")
    }

    private static func escape(_ value: String) -> String {
        value
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
    }
}
