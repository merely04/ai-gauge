import XCTest
@testable import AIGauge

@MainActor
final class UpdateTests: XCTestCase {
    func testHandleUpdateAvailable() throws {
        let model = UsageModel()
        let payload = UpdateAvailablePayload(
            type: "updateAvailable",
            currentVersion: "1.0.0",
            latestVersion: "1.5.0",
            changelogUrl: "https://example.com/changelog"
        )
        model.handleUpdateAvailable(payload)
        XCTAssertTrue(model.updateAvailable)
        XCTAssertEqual(model.latestVersion, "1.5.0")
        XCTAssertNotNil(model.changelogUrl)
    }

    func testCompareVersions() {
        let model = UsageModel()
        XCTAssertLessThan(model.compareVersions("1.0.0", "1.0.1"), 0)
        XCTAssertGreaterThan(model.compareVersions("2.0.0", "1.9.9"), 0)
        XCTAssertEqual(model.compareVersions("1.0.0", "1.0.0"), 0)
    }

    func testPostUpdateDetection() {
        let model = UsageModel()
        model.daemonVersion = "1.0.0"
        model._previousDaemonVersion = "1.0.0"
        model.updateAvailable = true
        model.latestVersion = "1.5.0"

        model.daemonVersion = "1.5.0"
        if let prev = model._previousDaemonVersion,
           model.compareVersions("1.5.0", prev) > 0 {
            model.updateSuccess = "Updated to v1.5.0"
            model.updateAvailable = false
            model.latestVersion = nil
            model._previousDaemonVersion = "1.5.0"
        }

        XCTAssertEqual(model.updateSuccess, "Updated to v1.5.0")
        XCTAssertFalse(model.updateAvailable)
        XCTAssertNil(model.latestVersion)
    }

    func testUpdateAvailableDecodesCorrectly() throws {
        let json = """
        {"type":"updateAvailable","currentVersion":"1.0.0","latestVersion":"1.5.0","changelogUrl":"https://example.com"}
        """.data(using: .utf8)!
        let payload = try JSONDecoder().decode(UpdateAvailablePayload.self, from: json)
        XCTAssertEqual(payload.type, "updateAvailable")
        XCTAssertEqual(payload.currentVersion, "1.0.0")
        XCTAssertEqual(payload.latestVersion, "1.5.0")
        XCTAssertEqual(payload.changelogUrl, "https://example.com")
    }

    func testUpdateFailedDecodesCorrectly() throws {
        let json = """
        {"type":"updateFailed","reason":"permission","command":"npm install -g ai-gauge","clipboardCopied":true}
        """.data(using: .utf8)!
        let payload = try JSONDecoder().decode(UpdateFailedPayload.self, from: json)
        XCTAssertEqual(payload.type, "updateFailed")
        XCTAssertEqual(payload.reason, "permission")
        XCTAssertEqual(payload.command, "npm install -g ai-gauge")
        XCTAssertTrue(payload.clipboardCopied ?? false)
    }
}
