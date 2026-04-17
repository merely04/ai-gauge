import SwiftUI

@main
struct AIGaugeApp: App {
    @StateObject private var wsClient: WebSocketClient
    @StateObject private var usageModel: UsageModel
    @StateObject private var notificationManager: NotificationManager
    @StateObject private var configMutator: ConfigMutator

    init() {
        let ws = WebSocketClient()
        let usage = UsageModel()
        let notif = NotificationManager()
        let config = ConfigMutator(ws: ws)

        ws.onUsageUpdate = { payload in
            Task { @MainActor in
                usage.update(from: payload)
            }
        }
        ws.onNotify = { payload in
            Task { @MainActor in
                notif.show(
                    threshold: payload.threshold,
                    percentage: payload.percentage,
                    message: payload.message
                )
            }
        }

        _wsClient = StateObject(wrappedValue: ws)
        _usageModel = StateObject(wrappedValue: usage)
        _notificationManager = StateObject(wrappedValue: notif)
        _configMutator = StateObject(wrappedValue: config)

        ws.connect()
        notif.requestAuthorization()

        ConfigMutator.runSetPlanTestModeIfNeeded(using: ws)
    }

    var body: some Scene {
        MenuBarExtra {
            MenuBarView()
                .environmentObject(usageModel)
                .environmentObject(configMutator)
        } label: {
            Label {
                Text(usageModel.text.isEmpty ? "--" : usageModel.text)
                    .foregroundColor(urgencyColor(usageModel.urgency))
            } icon: {
                Image(systemName: "gauge.medium")
            }
        }
        .menuBarExtraStyle(.menu)
    }

    private func urgencyColor(_ urgency: Urgency) -> Color {
        switch urgency {
        case .ok: return .primary
        case .warning: return .orange
        case .critical: return .red
        }
    }
}
