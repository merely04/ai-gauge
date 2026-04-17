import Foundation
import Combine
@preconcurrency import UserNotifications

@MainActor
final class NotificationManager: ObservableObject {
    private let center: UNUserNotificationCenter
    private let defaults: UserDefaults
    private let authorizationRequestedKey = "ai-gauge.notifications.authorization-requested"

    init(
        center: UNUserNotificationCenter = .current(),
        defaults: UserDefaults = .standard
    ) {
        self.center = center
        self.defaults = defaults
    }

    func requestAuthorization() {
        guard defaults.bool(forKey: authorizationRequestedKey) == false else {
            return
        }

        center.requestAuthorization(options: [.alert, .sound]) { granted, _ in
            self.defaults.set(true, forKey: self.authorizationRequestedKey)
            self.defaults.set(granted, forKey: "ai-gauge.notifications.authorization-granted")
        }
    }

    func show(threshold: Int, percentage: Int, message: String) {
        center.getNotificationSettings { settings in
            guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else {
                return
            }

            let content = UNMutableNotificationContent()
            content.title = "AI Gauge — Usage at \(threshold)%"
            content.body = message
            content.sound = .default

            let request = UNNotificationRequest(
                identifier: "ai-gauge-threshold-\(threshold)",
                content: content,
                trigger: nil
            )

            self.center.add(request) { _ in
                FileHandle.standardError.write(Data("[notify] scheduled threshold=\(threshold) percentage=\(percentage)\n".utf8))
            }
        }
    }
}
