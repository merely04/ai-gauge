import Foundation
import Combine

enum Urgency {
    case ok
    case warning
    case critical

    static func from(percentage: Int) -> Urgency {
        if percentage >= 80 { return .critical }
        if percentage >= 50 { return .warning }
        return .ok
    }
}

@MainActor
final class UsageModel: ObservableObject {
    @Published var percentage: Int = 0
    @Published var text: String = "--"
    @Published var tooltip: String = ""
    @Published var urgency: Urgency = .ok
    @Published var plan: String = ""
    @Published var tokenSource: String = ""
    @Published var displayMode: String = "full"

    @Published var updateAvailable: Bool = false
    @Published var latestVersion: String? = nil
    @Published var updateInProgress: Bool = false
    @Published var updateError: String? = nil
    @Published var updateSuccess: String? = nil
    @Published var changelogUrl: String? = nil
    @Published var daemonVersion: String? = nil
    @Published var protocolVersion: Int? = nil
    @Published var autoCheckUpdatesEnabled: Bool = true

    var _previousDaemonVersion: String? = nil

    private static let dotFilled = "\u{25CF}"
    private static let dotEmpty = "\u{25CB}"
    private static let barFilled = "\u{2593}"
    private static let barEmpty = "\u{2591}"
    private static let timer = "\u{23F1}"
    private static let spark = "\u{2726}"

    private static func barCells(_ pct: Double) -> Int {
        max(0, min(10, Int(pct / 10.0)))
    }

    /// Replicates `render()` from `bin/ai-gauge-waybar` — transforms the raw
    /// Anthropic API broadcast into display-ready text/tooltip/urgency.
    func update(from payload: UsagePayload, now: Date = Date()) {
        let fivePct = payload.five_hour?.utilization ?? 0
        let sevenPct = payload.seven_day?.utilization ?? 0
        let fiveInt = Int(fivePct.rounded())
        let sevenInt = Int(sevenPct.rounded())

        self.percentage = fiveInt
        self.urgency = Urgency.from(percentage: fiveInt)

        let mode = payload.meta?.displayMode ?? "full"
        switch mode {
        case "percent-only":
            self.text = "\(Self.spark) \(fiveInt)%"
        case "bar-dots":
            let n = Self.barCells(fivePct)
            self.text = "\(Self.spark) \(String(repeating: Self.dotFilled, count: n))\(String(repeating: Self.dotEmpty, count: 10 - n))"
        case "number-bar":
            let n = Self.barCells(fivePct)
            self.text = "\(fiveInt)% \(String(repeating: Self.barFilled, count: n))\(String(repeating: Self.barEmpty, count: 10 - n))"
        case "time-to-reset":
            if let rem = Self.formatDuration(payload.five_hour?.resets_at, now: now), !rem.isEmpty {
                self.text = "\(Self.timer) \(rem)"
            } else {
                self.text = "\(Self.timer) --"
            }
        default:
            var textStr = "\(Self.spark) \(fiveInt)%"
            if let fiveRemaining = Self.formatDuration(payload.five_hour?.resets_at, now: now), !fiveRemaining.isEmpty {
                textStr += " \(fiveRemaining)"
            }
            textStr += " · \(sevenInt)%w"
            self.text = textStr
        }

        var tooltipStr = "Claude Code Usage"
        tooltipStr += "\n───────────────"
        tooltipStr += "\n5-hour:  \(fiveInt)%"
        if let fiveLong = Self.formatDurationLong(payload.five_hour?.resets_at, now: now), !fiveLong.isEmpty {
            tooltipStr += "  (resets in \(fiveLong))"
        }
        tooltipStr += "\nWeekly:  \(sevenInt)%"
        if let sevenLong = Self.formatDurationLong(payload.seven_day?.resets_at, now: now), !sevenLong.isEmpty {
            tooltipStr += "  (resets in \(sevenLong))"
        }

        if let sonnetPct = payload.seven_day_sonnet?.utilization {
            let sonnetInt = Int(sonnetPct.rounded())
            tooltipStr += "\nSonnet:  \(sonnetInt)%"
            if let sonnetLong = Self.formatDurationLong(payload.seven_day_sonnet?.resets_at, now: now), !sonnetLong.isEmpty {
                tooltipStr += "  (resets in \(sonnetLong))"
            }
        }

        if payload.extra_usage?.is_enabled == true {
            let extraPct = Int((payload.extra_usage?.utilization ?? 0).rounded())
            let extraUsed = (payload.extra_usage?.used_credits ?? 0) / 100.0
            let extraLimit = Int(((payload.extra_usage?.monthly_limit ?? 0) / 100.0).rounded())
            tooltipStr += "\n───────────────"
            tooltipStr += "\nExtra: $\(String(format: "%.2f", extraUsed))/$\(extraLimit) (\(extraPct)%)"
        }

        self.plan = payload.meta?.plan ?? ""
        self.tokenSource = payload.meta?.tokenSource ?? ""
        self.displayMode = payload.meta?.displayMode ?? "full"

        if let newVersion = payload.meta?.version {
            daemonVersion = newVersion
            protocolVersion = payload.meta?.protocolVersion
            autoCheckUpdatesEnabled = payload.meta?.autoCheckUpdates ?? true

            if let prev = _previousDaemonVersion, compareVersions(newVersion, prev) > 0 {
                updateSuccess = "Updated to v\(newVersion)"
                updateAvailable = false
                latestVersion = nil
                updateInProgress = false
                scheduleUpdateSuccessClear()
            }
            _previousDaemonVersion = newVersion
        }

        self.tooltip = tooltipStr

        if let logPath = ProcessInfo.processInfo.environment["AIGAUGE_TEXT_LOG_PATH"], !logPath.isEmpty {
            let fmt = ISO8601DateFormatter()
            fmt.formatOptions = [.withInternetDateTime]
            let tsStr = fmt.string(from: Date())
            let urgStr: String
            switch self.urgency {
            case .ok: urgStr = "ok"
            case .warning: urgStr = "warning"
            case .critical: urgStr = "critical"
            }
            let line = "{\"ts\":\"\(tsStr)\",\"text\":\(self.text.debugDescription),\"displayMode\":\"\(self.displayMode)\",\"urgency\":\"\(urgStr)\"}\n"
            if let handle = FileHandle(forWritingAtPath: logPath) {
                handle.seekToEndOfFile()
                handle.write(line.data(using: .utf8) ?? Data())
                handle.closeFile()
            } else {
                try? line.data(using: .utf8)?.write(to: URL(fileURLWithPath: logPath))
            }
        }
    }

    func handleUpdateAvailable(_ p: UpdateAvailablePayload) {
        updateAvailable = true
        latestVersion = p.latestVersion
        changelogUrl = p.changelogUrl
        updateError = nil
    }

    func handleUpdateInstalling(_ p: UpdateInstallingPayload) {
        updateInProgress = true
        updateError = nil
    }

    func handleUpdateFailed(_ p: UpdateFailedPayload) {
        updateInProgress = false
        updateError = p.reason
    }

    func handleUpdateComplete(_ p: UpdateCompletePayload) {
        updateInProgress = false
        updateAvailable = false
        latestVersion = nil
        updateError = nil
    }

    func scheduleUpdateSuccessClear(after seconds: Double = 10) {
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
            await MainActor.run {
                self?.updateSuccess = nil
            }
        }
    }

    func compareVersions(_ a: String, _ b: String) -> Int {
        let aParts = a.split(separator: ".").compactMap { Int($0) }
        let bParts = b.split(separator: ".").compactMap { Int($0) }
        let len = max(aParts.count, bParts.count)
        for i in 0..<len {
            let av = i < aParts.count ? aParts[i] : 0
            let bv = i < bParts.count ? bParts[i] : 0
            if av != bv { return av - bv }
        }
        return 0
    }

    // MARK: - Date helpers (port of waybar's formatDuration / formatDurationLong)

    /// Parses the ISO timestamps the server emits. Anthropic returns microsecond
    /// precision (e.g. `2026-04-17T22:00:00.410733+00:00`), which `.withFractionalSeconds`
    /// sometimes rejects, so we fall through several strategies.
    fileprivate static func parseISODate(_ s: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = formatter.date(from: s) { return d }

        formatter.formatOptions = [.withInternetDateTime]
        if let d = formatter.date(from: s) { return d }

        // Fallback: strip fractional seconds manually, keep timezone suffix.
        if let dotIdx = s.firstIndex(of: ".") {
            let remainder = s[dotIdx...]
            let tzStart = remainder.firstIndex(where: { $0 == "+" || $0 == "-" || $0 == "Z" }) ?? s.endIndex
            let trimmed = String(s[s.startIndex..<dotIdx]) + String(s[tzStart...])
            formatter.formatOptions = [.withInternetDateTime]
            return formatter.date(from: trimmed)
        }

        return nil
    }

    fileprivate static func remainingSeconds(_ resetsAt: String?, now: Date = Date()) -> TimeInterval? {
        guard let resetsAt, !resetsAt.isEmpty, resetsAt != "null" else { return nil }
        guard let date = parseISODate(resetsAt) else { return nil }
        return max(0, date.timeIntervalSince(now))
    }

    fileprivate static func formatDuration(_ resetsAt: String?, now: Date = Date()) -> String? {
        guard let remaining = remainingSeconds(resetsAt, now: now) else { return nil }
        if remaining <= 0 { return "now" }

        let hours = Int(remaining / 3600)
        let mins = Int(remaining.truncatingRemainder(dividingBy: 3600) / 60)

        if hours > 0 {
            return "\(hours)h\(String(format: "%02d", mins))m"
        }
        return "\(mins)m"
    }

    fileprivate static func formatDurationLong(_ resetsAt: String?, now: Date = Date()) -> String? {
        guard let remaining = remainingSeconds(resetsAt, now: now) else { return nil }
        if remaining <= 0 { return "now" }

        let days = Int(remaining / 86400)
        let hours = Int(remaining.truncatingRemainder(dividingBy: 86400) / 3600)
        let mins = Int(remaining.truncatingRemainder(dividingBy: 3600) / 60)

        if days > 0 { return "\(days)d \(hours)h \(mins)m" }
        if hours > 0 { return "\(hours)h \(mins)m" }
        return "\(mins)m"
    }
}
