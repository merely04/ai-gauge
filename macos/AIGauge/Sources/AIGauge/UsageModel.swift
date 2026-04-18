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

    /// Replicates `render()` from `bin/ai-gauge-waybar` — transforms the raw
    /// Anthropic API broadcast into display-ready text/tooltip/urgency.
    func update(from payload: UsagePayload) {
        let fivePct = payload.five_hour?.utilization ?? 0
        let sevenPct = payload.seven_day?.utilization ?? 0
        let fiveInt = Int(fivePct.rounded())
        let sevenInt = Int(sevenPct.rounded())

        self.percentage = fiveInt
        self.urgency = Urgency.from(percentage: fiveInt)

        var textStr = "✦ \(fiveInt)%"
        if let fiveRemaining = Self.formatDuration(payload.five_hour?.resets_at), !fiveRemaining.isEmpty {
            textStr += " \(fiveRemaining)"
        }
        textStr += " · \(sevenInt)%w"
        self.text = textStr

        var tooltipStr = "Claude Code Usage"
        tooltipStr += "\n───────────────"
        tooltipStr += "\n5-hour:  \(fiveInt)%"
        if let fiveLong = Self.formatDurationLong(payload.five_hour?.resets_at), !fiveLong.isEmpty {
            tooltipStr += "  (resets in \(fiveLong))"
        }
        tooltipStr += "\nWeekly:  \(sevenInt)%"
        if let sevenLong = Self.formatDurationLong(payload.seven_day?.resets_at), !sevenLong.isEmpty {
            tooltipStr += "  (resets in \(sevenLong))"
        }

        if let sonnetPct = payload.seven_day_sonnet?.utilization {
            let sonnetInt = Int(sonnetPct.rounded())
            tooltipStr += "\nSonnet:  \(sonnetInt)%"
            if let sonnetLong = Self.formatDurationLong(payload.seven_day_sonnet?.resets_at), !sonnetLong.isEmpty {
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

        let plan = payload.meta?.plan ?? "unknown"
        self.plan = payload.meta?.plan ?? ""
        self.tokenSource = payload.meta?.tokenSource ?? ""
        tooltipStr += "\n───────────────"
        tooltipStr += "\nPlan: \(plan)"
        if let tokenSource = payload.meta?.tokenSource, !tokenSource.isEmpty {
            tooltipStr += "\nToken source: \(tokenSource)"
        }

        self.tooltip = tooltipStr
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

    fileprivate static func remainingSeconds(_ resetsAt: String?) -> TimeInterval? {
        guard let resetsAt, !resetsAt.isEmpty, resetsAt != "null" else { return nil }
        guard let date = parseISODate(resetsAt) else { return nil }
        return max(0, date.timeIntervalSinceNow)
    }

    fileprivate static func formatDuration(_ resetsAt: String?) -> String? {
        guard let remaining = remainingSeconds(resetsAt) else { return nil }
        if remaining <= 0 { return "now" }

        let hours = Int(remaining / 3600)
        let mins = Int(remaining.truncatingRemainder(dividingBy: 3600) / 60)

        if hours > 0 {
            return "\(hours)h\(String(format: "%02d", mins))m"
        }
        return "\(mins)m"
    }

    fileprivate static func formatDurationLong(_ resetsAt: String?) -> String? {
        guard let remaining = remainingSeconds(resetsAt) else { return nil }
        if remaining <= 0 { return "now" }

        let days = Int(remaining / 86400)
        let hours = Int(remaining.truncatingRemainder(dividingBy: 86400) / 3600)
        let mins = Int(remaining.truncatingRemainder(dividingBy: 3600) / 60)

        if days > 0 { return "\(days)d \(hours)h \(mins)m" }
        if hours > 0 { return "\(hours)h \(mins)m" }
        return "\(mins)m"
    }
}
