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
        webSocketClient?.send("{\"type\":\"setConfig\",\"key\":\"tokenSource\",\"value\":\"\(Self.escape(source))\"}")
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
