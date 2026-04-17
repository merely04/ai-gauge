import Foundation
import Darwin

final class ConfigMutator {
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

    static func runSetPlanTestModeIfNeeded(using webSocketClient: WebSocketClient) {
        guard ProcessInfo.processInfo.environment["AIGAUGE_TEST_MODE"] == "setplan" else { return }
        let mutator = ConfigMutator(ws: webSocketClient)
        mutator.setPlan("team")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            exit(0)
        }
    }

    private static func escape(_ value: String) -> String {
        value
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
    }
}
