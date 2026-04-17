import AppKit
import Foundation

struct Actions {
    @MainActor
    static func copyUsage(_ model: UsageModel) {
        let text = "Usage: \(model.percentage)% — \(model.tooltip)"
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }
    
    static func restartServer() {
        let uid = getuid()
        let process = Process()
        process.launchPath = "/bin/launchctl"
        process.arguments = ["kickstart", "-k", "gui/\(uid)/com.ai-gauge.server"]
        try? process.run()
    }
    
    static func openConfig() {
        let configPath = "\(NSHomeDirectory())/.config/ai-gauge/config.json"
        NSWorkspace.shared.open(URL(fileURLWithPath: configPath))
    }
}
