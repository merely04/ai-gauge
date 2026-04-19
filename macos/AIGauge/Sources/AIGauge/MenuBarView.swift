import SwiftUI
import AppKit
import Foundation

struct MenuBarView: View {
    @EnvironmentObject var usageModel: UsageModel
    @EnvironmentObject var configMutator: ConfigMutator
    @EnvironmentObject var webSocketClient: WebSocketClient

    private let plans: [String] = ["max", "pro", "team", "enterprise", "unknown"]
    private let sources: [(value: String, display: String)] = [
        ("claude-code", "Claude Code"),
        ("opencode", "OpenCode")
    ]

    var body: some View {
        tooltipSection

        Divider()

        primaryActions

        Divider()

        Button(action: { configMutator.refresh() }) {
            Label("Refresh now", systemImage: "arrow.clockwise")
                .labelStyle(.titleAndIcon)
        }

        updateSection

        systemActions

        Divider()

        Button(action: { NSApp.terminate(nil) }) {
            Label("Quit AI Gauge", systemImage: "power")
                .labelStyle(.titleAndIcon)
        }
    }

    @ViewBuilder
    private var tooltipSection: some View {
        ForEach(Array(tooltipLines.enumerated()), id: \.offset) { _, line in
            Text(line)
                .foregroundColor(urgencyColor)
        }
    }

    @ViewBuilder
    private var primaryActions: some View {
        Button(action: { Actions.copyUsage(usageModel) }) {
            Label("Copy usage summary", systemImage: "doc.on.doc")
                .labelStyle(.titleAndIcon)
        }

        Menu {
            ForEach(plans, id: \.self) { plan in
                planButton(for: plan)
            }
        } label: {
            Label("Change plan", systemImage: "star.circle")
                .labelStyle(.titleAndIcon)
        }

        Menu {
            ForEach(sources, id: \.value) { source in
                sourceButton(value: source.value, display: source.display)
            }
        } label: {
            Label("Change token source", systemImage: "key.fill")
                .labelStyle(.titleAndIcon)
        }
    }

    @ViewBuilder
    private var updateSection: some View {
        updateStatusItems

        if usageModel.updateAvailable || usageModel.updateError != nil || usageModel.updateSuccess != nil {
            Divider()
        }

        Button(action: { webSocketClient.sendCheckUpdate() }) {
            Label("Check for updates now", systemImage: "arrow.clockwise")
                .labelStyle(.titleAndIcon)
        }

        if let url = usageModel.changelogUrl, let urlObj = URL(string: url) {
            Button(action: { NSWorkspace.shared.open(urlObj) }) {
                Label("View changelog", systemImage: "doc.text")
                    .labelStyle(.titleAndIcon)
            }
        }

        Divider()

        autoCheckMenu

        Divider()
    }

    @ViewBuilder
    private var autoCheckMenu: some View {
        Menu {
            Toggle("On", isOn: Binding(
                get: { usageModel.autoCheckUpdatesEnabled },
                set: { newValue in
                    if newValue { configMutator.setAutoCheckUpdates(true) }
                }
            ))
            Toggle("Off", isOn: Binding(
                get: { !usageModel.autoCheckUpdatesEnabled },
                set: { newValue in
                    if newValue { configMutator.setAutoCheckUpdates(false) }
                }
            ))
        } label: {
            Label("Auto-check for updates", systemImage: "clock.arrow.circlepath")
                .labelStyle(.titleAndIcon)
        }
    }

    @ViewBuilder
    private var updateStatusItems: some View {
        if usageModel.updateInProgress {
            Label("Updating...", systemImage: "arrow.clockwise")
                .labelStyle(.titleAndIcon)
        } else if let version = usageModel.latestVersion, usageModel.updateAvailable {
            Button(action: { webSocketClient.sendDoUpdate() }) {
                Label("Update to v\(version)", systemImage: "arrow.down.circle")
                    .labelStyle(.titleAndIcon)
            }
        }

        if let errorText = usageModel.updateError {
            Label("Update failed: \(errorText)", systemImage: "exclamationmark.triangle")
                .labelStyle(.titleAndIcon)
                .foregroundStyle(.red)
            Button(action: { webSocketClient.sendDoUpdate() }) {
                Label("Try again", systemImage: "arrow.clockwise")
                    .labelStyle(.titleAndIcon)
            }
        }

        if let successText = usageModel.updateSuccess {
            Label(successText, systemImage: "checkmark.circle")
                .labelStyle(.titleAndIcon)
                .foregroundStyle(.green)
        }
    }

    @ViewBuilder
    private var systemActions: some View {
        Button(action: { Actions.restartServer() }) {
            Label("Restart server", systemImage: "arrow.triangle.2.circlepath")
                .labelStyle(.titleAndIcon)
        }

        Button(action: { Actions.revealConfigInFinder() }) {
            Label("Reveal Config in Finder", systemImage: "folder")
                .labelStyle(.titleAndIcon)
        }

        Button(action: { Actions.showAbout() }) {
            Label("About AI Gauge", systemImage: "info.circle")
                .labelStyle(.titleAndIcon)
        }
    }

    @ViewBuilder
    private func planButton(for plan: String) -> some View {
        Toggle(plan, isOn: Binding(
            get: { usageModel.plan == plan },
            set: { newValue in
                if newValue {
                    configMutator.setPlan(plan)
                }
            }
        ))
    }

    @ViewBuilder
    private func sourceButton(value: String, display: String) -> some View {
        Toggle(display, isOn: Binding(
            get: { usageModel.tokenSource == value },
            set: { newValue in
                if newValue {
                    configMutator.setTokenSource(value)
                }
            }
        ))
    }

    private var tooltipLines: [String] {
        if usageModel.tooltip.isEmpty {
            return ["Connecting to ai-gauge-server..."]
        }
        return usageModel.tooltip.components(separatedBy: "\n")
    }

    private var urgencyColor: Color {
        switch usageModel.urgency {
        case .ok: return Color.primary
        case .warning: return .orange
        case .critical: return .red
        }
    }
}
