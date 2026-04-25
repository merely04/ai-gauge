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
    static let SUPPORTED_PROTOCOL_VERSION = 3

    /// Keep in sync with `lib/config.js:TOKEN_SOURCE_PATTERN`.
    nonisolated static let TOKEN_SOURCE_PATTERN = #"^(claude-code|opencode|codex|claude-settings:[a-zA-Z0-9_][a-zA-Z0-9_.-]*)$"#

    nonisolated static func isValidTokenSource(_ value: String) -> Bool {
        guard let regex = try? NSRegularExpression(pattern: TOKEN_SOURCE_PATTERN) else { return false }
        let range = NSRange(value.startIndex..., in: value)
        return regex.firstMatch(in: value, range: range) != nil
    }

    @Published var percentage: Int = 0
    @Published var text: String = "--"
    @Published var tooltip: String = ""
    @Published var urgency: Urgency = .ok
    @Published var plan: String = ""
    @Published var tokenSource: String = ""
    @Published var displayMode: String = "full"
    @Published var provider: String = ""

    @Published var updateAvailable: Bool = false
    @Published var latestVersion: String? = nil
    @Published var updateInProgress: Bool = false
    @Published var updateError: String? = nil
    @Published var updateSuccess: String? = nil
    @Published var changelogUrl: String? = nil
    @Published var daemonVersion: String? = nil
    @Published var protocolVersion: Int? = nil
    @Published var autoCheckUpdatesEnabled: Bool = true
    @Published var protocolMismatch: Bool = false

    @Published var availableSources: [DiscoveredSource] = []

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
        if let pv = payload.meta?.protocolVersion {
            self.protocolMismatch = pv > Self.SUPPORTED_PROTOCOL_VERSION
        } else {
            self.protocolMismatch = false
        }

        self.provider = payload.meta?.provider ?? ""
        let indicator = Self.providerIndicator(provider)
        let isBalanceOnly = payload.five_hour?.utilization == nil
        let isWaiting = payload.five_hour == nil && payload.balance == nil

        let fivePct = payload.five_hour?.utilization ?? 0
        let sevenPct = payload.seven_day?.utilization ?? 0
        let fiveInt = Int(fivePct.rounded())
        let sevenInt = Int(sevenPct.rounded())

        self.percentage = fiveInt
        self.urgency = Urgency.from(percentage: fiveInt)

        if isWaiting {
            self.text = "\(Self.spark) --\(indicator)"
        } else if isBalanceOnly && !indicator.isEmpty {
            self.text = "\(Self.spark) --\(indicator)"
        } else {
            let mode = payload.meta?.displayMode ?? "full"
            var baseText: String
            switch mode {
            case "percent-only":
                baseText = "\(Self.spark) \(fiveInt)%"
            case "bar-dots":
                let n = Self.barCells(fivePct)
                baseText = "\(Self.spark) \(String(repeating: Self.dotFilled, count: n))\(String(repeating: Self.dotEmpty, count: 10 - n))"
            case "number-bar":
                let n = Self.barCells(fivePct)
                baseText = "\(fiveInt)% \(String(repeating: Self.barFilled, count: n))\(String(repeating: Self.barEmpty, count: 10 - n))"
            case "time-to-reset":
                if let rem = Self.formatDuration(payload.five_hour?.resets_at, now: now), !rem.isEmpty {
                    baseText = "\(Self.timer) \(rem)"
                } else {
                    baseText = "\(Self.timer) --"
                }
            default:
                var textStr = "\(Self.spark) \(fiveInt)%"
                if let fiveRemaining = Self.formatDuration(payload.five_hour?.resets_at, now: now), !fiveRemaining.isEmpty {
                    textStr += " \(fiveRemaining)"
                }
                textStr += " · \(sevenInt)%w"
                baseText = textStr
            }
            self.text = baseText + indicator
        }

        var tooltipStr = Self.providerLabel(provider: self.provider, tokenSource: payload.meta?.tokenSource ?? "")
        if isWaiting {
            tooltipStr += "\n───────────────"
            tooltipStr += "\nWaiting for data…"
            tooltipStr += "\n(check daemon logs if this persists)"
            self.tooltip = tooltipStr
            self.plan = payload.meta?.plan ?? ""
            self.tokenSource = payload.meta?.tokenSource ?? ""
            self.displayMode = payload.meta?.displayMode ?? "full"
            return
        }
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

        if !self.provider.isEmpty {
            tooltipStr += "\nProvider: \(self.provider)"
        }

        if let bal = payload.balance {
            if let totalCents = bal.total_cents, let usedCents = bal.used_cents {
                let total = Double(totalCents) / 100.0
                let used = Double(usedCents) / 100.0
                tooltipStr += String(format: "\nBalance: $%.2f / $%.2f", used, total)
            } else if let usedCents = bal.used_cents {
                let used = Double(usedCents) / 100.0
                tooltipStr += String(format: "\nBalance: $%.2f used", used)
            } else if let totalCents = bal.total_cents {
                let total = Double(totalCents) / 100.0
                tooltipStr += String(format: "\nBalance: $%.2f available", total)
            }
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

        writeMenuStateSnapshot()
    }

    func updateSources(_ sources: [DiscoveredSource]) {
        self.availableSources = sources
        writeMenuStateSnapshot()
    }

    func applyTestProtocolVersion(_ pv: Int) {
        self.protocolMismatch = pv > Self.SUPPORTED_PROTOCOL_VERSION
        writeMenuStateSnapshot()
    }

    func applyTestProvider(
        _ providerName: String,
        fiveHour: Int? = nil,
        sevenDay: Int? = nil,
        balanceTotalCents: Int? = nil,
        balanceUsedCents: Int? = nil
    ) {
        let fiveWindow = fiveHour.map { UsagePayload.Window(utilization: Double($0), resets_at: nil) }
        let sevenWindow = sevenDay.map { UsagePayload.Window(utilization: Double($0), resets_at: nil) }
        let balance: UsagePayload.Balance?
        if balanceTotalCents != nil || balanceUsedCents != nil {
            balance = UsagePayload.Balance(
                currency: "USD",
                total_cents: balanceTotalCents,
                used_cents: balanceUsedCents,
                remaining_cents: nil,
                percentage: nil
            )
        } else {
            balance = nil
        }
        let meta = UsagePayload.Meta(
            plan: nil,
            fetchedAt: nil,
            tokenSource: nil,
            version: nil,
            protocolVersion: 2,
            autoCheckUpdates: nil,
            displayMode: nil,
            provider: providerName
        )
        let synth = UsagePayload(
            five_hour: fiveWindow,
            seven_day: sevenWindow,
            seven_day_sonnet: nil,
            code_review: nil,
            extra_usage: nil,
            balance: balance,
            meta: meta
        )
        update(from: synth)
    }

    func writeMenuStateSnapshot() {
        guard let path = ProcessInfo.processInfo.environment["AIGAUGE_MENU_STATE_PATH"], !path.isEmpty else { return }

        let sourcesJson: [[String: Any]] = availableSources.map { source in
            var d: [String: Any] = [
                "name": source.name,
                "provider": source.provider,
                "hasToken": source.hasToken,
                "supported": source.supported,
            ]
            d["baseUrl"] = source.baseUrl ?? NSNull()
            d["skipReason"] = source.skipReason ?? NSNull()
            return d
        }

        let state: [String: Any] = [
            "menubarText": text,
            "tooltip": tooltip,
            "protocolMismatch": protocolMismatch,
            "provider": provider,
            "availableSources": sourcesJson,
            "currentTokenSource": tokenSource,
        ]

        guard let data = try? JSONSerialization.data(withJSONObject: state, options: [.prettyPrinted]) else { return }
        let url = URL(fileURLWithPath: path)
        try? data.write(to: url, options: .atomic)
    }

    static func providerIndicator(_ provider: String) -> String {
        switch provider {
        case "zai": return "z"
        case "minimax": return "m"
        case "openrouter": return "o"
        case "komilion": return "k"
        case "packy": return "p"
        case "codex": return "◆"
        case "unknown": return "?"
        default: return ""
        }
    }

    static func providerLabel(provider: String, tokenSource: String) -> String {
        switch provider {
        case "codex": return "Codex Usage"
        case "zai": return "Z.ai Usage"
        case "minimax": return "MiniMax Usage"
        case "openrouter": return "OpenRouter Usage"
        case "komilion": return "Komilion Usage"
        case "packy": return "Packy Usage"
        default:
            if tokenSource.hasPrefix("claude-settings:") {
                let name = String(tokenSource.dropFirst("claude-settings:".count))
                return "Claude (\(name)) Usage"
            }
            if tokenSource == "opencode" { return "OpenCode Usage" }
            return "Claude Code Usage"
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
        if let from = p.fromVersion, let to = p.installedVersion, !from.isEmpty, !to.isEmpty {
            changelogUrl = "https://github.com/merely04/ai-gauge/compare/v\(from)...v\(to)"
        }
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
