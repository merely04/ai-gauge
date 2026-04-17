import Foundation
@preconcurrency import UserNotifications

@MainActor
final class NotificationManager {
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
            UserDefaults.standard.set(true, forKey: self.authorizationRequestedKey)
            UserDefaults.standard.set(granted, forKey: "ai-gauge.notifications.authorization-granted")
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

            UNUserNotificationCenter.current().add(request) { _ in
                FileHandle.standardError.write(Data("[notify] scheduled threshold=\(threshold) percentage=\(percentage)\n".utf8))
            }
        }
    }
}
