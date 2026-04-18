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

        Button("Copy usage summary") {
            Actions.copyUsage(usageModel)
        }

        Menu("Change plan") {
            ForEach(plans, id: \.self) { plan in
                planButton(for: plan)
            }
        }

        Menu("Change token source") {
            ForEach(sources, id: \.value) { source in
                sourceButton(value: source.value, display: source.display)
            }
        }

        Divider()

        Button("Refresh now") {
            configMutator.refresh()
        }

        Button("Restart server") {
            Actions.restartServer()
        }

        Button("Reveal Config in Finder") {
            Actions.revealConfigInFinder()
        }

        Button("About AI Gauge") {
            Actions.showAbout()
        }

        Divider()

        Button("Quit AI Gauge") {
            NSApp.terminate(nil)
        }
    }

    @ViewBuilder
    private func planButton(for plan: String) -> some View {
        Button {
            configMutator.setPlan(plan)
        } label: {
            if usageModel.plan == plan {
                Label(plan, systemImage: "checkmark")
            } else {
                Text(plan)
            }
        }
    }

    @ViewBuilder
    private func sourceButton(value: String, display: String) -> some View {
        Button {
            configMutator.setTokenSource(value)
        } label: {
            if usageModel.tokenSource == value {
                Label(display, systemImage: "checkmark")
            } else {
                Text(display)
            }
        }
    }

    private var urgencyColor: Color {
        switch usageModel.urgency {
        case .ok: return .primary
        case .warning: return .orange
        case .critical: return .red
        }
    }
}
