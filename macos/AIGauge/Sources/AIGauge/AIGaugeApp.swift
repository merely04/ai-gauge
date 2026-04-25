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
        ws.onUpdateAvailable = { [weak usage, weak notif] payload in
            Task { @MainActor in
                usage?.handleUpdateAvailable(payload)
                notif?.showUpdateAvailable(version: payload.latestVersion)
            }
        }
        ws.onUpdateInstalling = { [weak usage] payload in
            Task { @MainActor in
                usage?.handleUpdateInstalling(payload)
            }
        }
        ws.onUpdateFailed = { [weak usage, weak notif] payload in
            Task { @MainActor in
                usage?.handleUpdateFailed(payload)
                notif?.showUpdateFailed(reason: payload.reason, command: payload.command)
            }
        }
        ws.onUpdateComplete = { [weak usage, weak notif] payload in
            Task { @MainActor in
                usage?.handleUpdateComplete(payload)
                let version = payload.installedVersion ?? "unknown"
                notif?.showUpdateComplete(version: version)
            }
        }
        ws.onUpdateCheckFailed = { _ in }
        ws.onUpdateAlreadyInProgress = { }
        ws.onSettingsFiles = { [weak usage] sources in
            Task { @MainActor in
                usage?.updateSources(sources)
            }
        }
        ws.onConfigError = { [weak usage] payload in
            Task { @MainActor in
                usage?.handleConfigError(payload)
            }
        }
        ws.onDaemonUnreachable = { [weak usage] in
            Task { @MainActor in
                usage?.markDaemonUnreachable()
            }
        }
        ws.onConnect = { [weak ws] in
            ws?.requestSettingsFiles()
        }

        _wsClient = StateObject(wrappedValue: ws)
        _usageModel = StateObject(wrappedValue: usage)
        _notificationManager = StateObject(wrappedValue: notif)
        _configMutator = StateObject(wrappedValue: config)

        Self.applyTestEnvHooks(usage: usage)

        if !Self.isSyntheticStateMode() {
            ws.connect()
        }
        notif.requestAuthorization()
    }

    private static func isSyntheticStateMode() -> Bool {
        let env = ProcessInfo.processInfo.environment
        let protocolSet = env["AIGAUGE_TEST_PROTOCOL_VERSION"].map { !$0.isEmpty } ?? false
        let providerSet = env["AIGAUGE_TEST_PROVIDER"].map { !$0.isEmpty } ?? false
        return protocolSet || providerSet
    }

    private static func applyTestEnvHooks(usage: UsageModel) {
        let env = ProcessInfo.processInfo.environment

        Task { @MainActor in
            if env["AIGAUGE_TEST_UPDATE_AVAILABLE"] == "1" {
                let testVersion = env["AIGAUGE_TEST_LATEST_VERSION"] ?? "9.9.9"
                let currentVersion = "1.0.0"
                let payload = UpdateAvailablePayload(
                    type: "updateAvailable",
                    currentVersion: currentVersion,
                    latestVersion: testVersion,
                    changelogUrl: "https://github.com/merely04/ai-gauge/compare/v\(currentVersion)...v\(testVersion)"
                )
                usage.handleUpdateAvailable(payload)
            }
            if env["AIGAUGE_TEST_UPDATE_INSTALLING"] == "1" {
                usage.updateInProgress = true
            }
            if let reason = env["AIGAUGE_TEST_UPDATE_FAILED"], !reason.isEmpty {
                let payload = UpdateFailedPayload(
                    type: "updateFailed",
                    reason: reason,
                    command: nil,
                    clipboardCopied: nil
                )
                usage.handleUpdateFailed(payload)
            }
            if let pvStr = env["AIGAUGE_TEST_PROTOCOL_VERSION"], let pv = Int(pvStr) {
                usage.applyTestProtocolVersion(pv)
            }
            if let providerStr = env["AIGAUGE_TEST_PROVIDER"], !providerStr.isEmpty {
                usage.applyTestProvider(
                    providerStr,
                    fiveHour: env["AIGAUGE_TEST_FIVE_HOUR"].flatMap(Int.init),
                    sevenDay: env["AIGAUGE_TEST_SEVEN_DAY"].flatMap(Int.init),
                    balanceTotalCents: env["AIGAUGE_TEST_BALANCE_TOTAL_CENTS"].flatMap(Int.init),
                    balanceUsedCents: env["AIGAUGE_TEST_BALANCE_USED_CENTS"].flatMap(Int.init)
                )
            }
        }
    }

    var body: some Scene {
        MenuBarExtra {
            MenuBarView()
                .environmentObject(usageModel)
                .environmentObject(configMutator)
                .environmentObject(wsClient)
        } label: {
            HStack(spacing: 4) {
                Text(usageModel.text.isEmpty ? "--" : usageModel.text)
                    .foregroundColor(urgencyColor(usageModel.urgency))
                if usageModel.updateAvailable {
                    Image(systemName: "circle.fill")
                        .foregroundStyle(.orange)
                        .font(.system(size: 6))
                }
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
