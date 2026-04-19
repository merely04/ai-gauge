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

    // MARK: - Update notifications

    func showUpdateAvailable(version: String) {
        let content = UNMutableNotificationContent()
        content.title = "AI Gauge Update"
        content.body = "v\(version) is available"
        content.categoryIdentifier = "ai-gauge.update.available"

        let request = UNNotificationRequest(
            identifier: "ai-gauge.update.available.\(version)",
            content: content,
            trigger: nil
        )

        center.add(request) { _ in
            FileHandle.standardError.write(Data("[notify] scheduled update-available v\(version)\n".utf8))
        }
    }

    func showUpdateFailed(reason: String, command: String?) {
        let content = UNMutableNotificationContent()
        content.title = "AI Gauge Update Failed"
        content.body = reason + (command.map { "\nRun: \($0)" } ?? "")
        content.categoryIdentifier = "ai-gauge.update.failed"

        let request = UNNotificationRequest(
            identifier: "ai-gauge.update.failed",
            content: content,
            trigger: nil
        )

        center.add(request) { _ in
            FileHandle.standardError.write(Data("[notify] scheduled update-failed reason=\(reason)\n".utf8))
        }
    }

    func showUpdateComplete(version: String) {
        let content = UNMutableNotificationContent()
        content.title = "AI Gauge Updated"
        content.body = "Updated to v\(version)"
        content.categoryIdentifier = "ai-gauge.update.complete"

        let request = UNNotificationRequest(
            identifier: "ai-gauge.update.complete.\(version)",
            content: content,
            trigger: nil
        )

        center.add(request) { _ in
            FileHandle.standardError.write(Data("[notify] scheduled update-complete v\(version)\n".utf8))
        }
    }
}
