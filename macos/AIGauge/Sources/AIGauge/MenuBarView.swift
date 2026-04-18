import SwiftUI
import AppKit
import Foundation

struct MenuBarView: View {
    @EnvironmentObject var usageModel: UsageModel
    @EnvironmentObject var configMutator: ConfigMutator

    private let plans: [String] = ["max", "pro", "team", "enterprise", "unknown"]
    private let sources: [(value: String, display: String)] = [
        ("claude-code", "Claude Code"),
        ("opencode", "OpenCode")
    ]

    var body: some View {
        Text(usageModel.tooltip.isEmpty ? "Connecting to ai-gauge-server..." : usageModel.tooltip)
            .foregroundColor(urgencyColor)

        Divider()

        Button(action: { Actions.copyUsage(usageModel) }) {
            Label("Copy usage summary", systemImage: "doc.on.doc")
        }

        Menu {
            ForEach(plans, id: \.self) { plan in
                planButton(for: plan)
            }
        } label: {
            Label("Change plan", systemImage: "star.circle")
        }

        Menu {
            ForEach(sources, id: \.value) { source in
                sourceButton(value: source.value, display: source.display)
            }
        } label: {
            Label("Change token source", systemImage: "key.fill")
        }

        Divider()

        Button(action: { configMutator.refresh() }) {
            Label("Refresh now", systemImage: "arrow.clockwise")
        }

        Button(action: { Actions.restartServer() }) {
            Label("Restart server", systemImage: "arrow.triangle.2.circlepath")
        }

        Button(action: { Actions.revealConfigInFinder() }) {
            Label("Reveal Config in Finder", systemImage: "folder")
        }

        Button(action: { Actions.showAbout() }) {
            Label("About AI Gauge", systemImage: "info.circle")
        }

        Divider()

        Button(action: { NSApp.terminate(nil) }) {
            Label("Quit AI Gauge", systemImage: "power")
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

    private var urgencyColor: Color {
        switch usageModel.urgency {
        case .ok: return .primary
        case .warning: return .orange
        case .critical: return .red
        }
    }
}
