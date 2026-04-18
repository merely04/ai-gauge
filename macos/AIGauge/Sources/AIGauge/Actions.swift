import AppKit
import Foundation

struct Actions {
    @MainActor
    static func showAbout() {
        NSApplication.shared.orderFrontStandardAboutPanel(options: [
            NSApplication.AboutPanelOptionKey.credits: loadCreditsAttributedString() ?? NSAttributedString(string: "")
        ])
        NSApplication.shared.activate(ignoringOtherApps: true)
    }

    @MainActor
    static func copyUsage(_ model: UsageModel) {
        let text = "Usage: \(model.percentage)% — \(model.tooltip)"
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }
    
    static func restartServer() {
        let uid = getuid()
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        process.arguments = ["kickstart", "-k", "gui/\(uid)/com.ai-gauge.server"]
        try? process.run()
    }
    
    static func revealConfigInFinder() {
        let configPath = "\(NSHomeDirectory())/.config/ai-gauge/config.json"
        NSWorkspace.shared.selectFile(configPath, inFileViewerRootedAtPath: "")
    }

    private static func loadCreditsAttributedString() -> NSAttributedString? {
        guard let url = Bundle.main.url(forResource: "Credits", withExtension: "rtf") else {
            return nil
        }
        return try? NSAttributedString(url: url, options: [:], documentAttributes: nil)
    }
}
