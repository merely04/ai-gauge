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

    func update(from payload: UsagePayload) {
        percentage = payload.percentage
        text = payload.text
        tooltip = payload.tooltip
        urgency = Urgency.from(percentage: payload.percentage)
    }
}
