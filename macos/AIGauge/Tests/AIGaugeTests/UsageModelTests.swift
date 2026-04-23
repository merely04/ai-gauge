import XCTest
@testable import AIGauge

@MainActor
final class UsageModelTests: XCTestCase {

    func testSettingsFilesPayloadDecodes() throws {
        let json = """
        {"type":"settingsFiles","files":[
          {"name":"default","provider":"anthropic","baseUrl":null,"hasToken":true,"supported":true},
          {"name":"z","provider":"zai","baseUrl":"https://api.z.ai","hasToken":true,"supported":true},
          {"name":"bad","provider":"unknown","baseUrl":null,"hasToken":false,"supported":false,"skipReason":"symlink"}
        ]}
        """.data(using: .utf8)!
        let payload = try JSONDecoder().decode(SettingsFilesPayload.self, from: json)
        XCTAssertEqual(payload.type, "settingsFiles")
        XCTAssertEqual(payload.files.count, 3)
        XCTAssertEqual(payload.files[1].provider, "zai")
        XCTAssertEqual(payload.files[2].skipReason, "symlink")
        XCTAssertFalse(payload.files[2].supported)
    }

    func testUpdateSourcesSetsAvailableSources() {
        let model = UsageModel()
        XCTAssertTrue(model.availableSources.isEmpty)
        let sources = [
            DiscoveredSource(name: "default", provider: "anthropic", baseUrl: nil, hasToken: true, supported: true, skipReason: nil),
            DiscoveredSource(name: "z", provider: "zai", baseUrl: "https://api.z.ai", hasToken: true, supported: true, skipReason: nil),
        ]
        model.updateSources(sources)
        XCTAssertEqual(model.availableSources.count, 2)
        XCTAssertEqual(model.availableSources[1].name, "z")
    }

    func testMenuStateSnapshotWrittenWhenEnvSet() throws {
        let tmp = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("aigauge-test-\(UUID().uuidString).json")
        defer { try? FileManager.default.removeItem(at: tmp) }

        setenv("AIGAUGE_MENU_STATE_PATH", tmp.path, 1)
        defer { unsetenv("AIGAUGE_MENU_STATE_PATH") }

        let model = UsageModel()
        model.updateSources([
            DiscoveredSource(name: "z", provider: "zai", baseUrl: "https://api.z.ai", hasToken: true, supported: true, skipReason: nil),
            DiscoveredSource(name: "bad", provider: "unknown", baseUrl: nil, hasToken: false, supported: false, skipReason: "symlink"),
        ])

        XCTAssertTrue(FileManager.default.fileExists(atPath: tmp.path))
        let data = try Data(contentsOf: tmp)
        let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        XCTAssertNotNil(obj)
        let sources = obj?["availableSources"] as? [[String: Any]]
        XCTAssertEqual(sources?.count, 2)
        let bad = sources?.first(where: { $0["name"] as? String == "bad" })
        XCTAssertEqual(bad?["supported"] as? Bool, false)
        XCTAssertEqual(bad?["skipReason"] as? String, "symlink")
    }

    func testProtocolVersionGatingV1DoesNotTriggerBanner() {
        let model = UsageModel()
        model.applyTestProtocolVersion(1)
        XCTAssertFalse(model.protocolMismatch)
    }

    func testProtocolVersionGatingCurrentDoesNotTriggerBanner() {
        let model = UsageModel()
        model.applyTestProtocolVersion(UsageModel.SUPPORTED_PROTOCOL_VERSION)
        XCTAssertFalse(model.protocolMismatch)
    }

    func testProtocolVersionGatingFutureTriggersBanner() {
        let model = UsageModel()
        model.applyTestProtocolVersion(99)
        XCTAssertTrue(model.protocolMismatch)
    }

    func testProtocolMismatchFromUpdatePayload() {
        let model = UsageModel()
        let meta = UsagePayload.Meta(
            plan: nil, fetchedAt: nil, tokenSource: nil, version: nil,
            protocolVersion: 99, autoCheckUpdates: nil, displayMode: nil, provider: nil
        )
        let payload = UsagePayload(
            five_hour: UsagePayload.Window(utilization: 10, resets_at: nil),
            seven_day: nil, seven_day_sonnet: nil, extra_usage: nil, balance: nil, meta: meta
        )
        model.update(from: payload)
        XCTAssertTrue(model.protocolMismatch)
    }

    func testProtocolMismatchSnapshotIncludesFlag() throws {
        let tmp = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("aigauge-test-\(UUID().uuidString).json")
        defer { try? FileManager.default.removeItem(at: tmp) }

        setenv("AIGAUGE_MENU_STATE_PATH", tmp.path, 1)
        defer { unsetenv("AIGAUGE_MENU_STATE_PATH") }

        let model = UsageModel()
        model.applyTestProtocolVersion(99)

        let data = try Data(contentsOf: tmp)
        let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        XCTAssertEqual(obj?["protocolMismatch"] as? Bool, true)
    }

    func testAnthropicTextUnchangedTooltipHasProvider() {
        let model = UsageModel()
        let meta = UsagePayload.Meta(
            plan: "pro", fetchedAt: nil, tokenSource: "claude-code", version: nil,
            protocolVersion: 2, autoCheckUpdates: nil, displayMode: "full", provider: "anthropic"
        )
        let payload = UsagePayload(
            five_hour: UsagePayload.Window(utilization: 45, resets_at: nil),
            seven_day: UsagePayload.Window(utilization: 15, resets_at: nil),
            seven_day_sonnet: nil, extra_usage: nil, balance: nil, meta: meta
        )
        model.update(from: payload)

        XCTAssertEqual(model.text, "\u{2726} 45% · 15%w")
        XCTAssertTrue(model.tooltip.contains("Provider: anthropic"))
        XCTAssertFalse(model.text.hasSuffix("a"))
    }

    func testZaiTextHasZSuffix() {
        let model = UsageModel()
        let meta = UsagePayload.Meta(
            plan: nil, fetchedAt: nil, tokenSource: nil, version: nil,
            protocolVersion: 2, autoCheckUpdates: nil, displayMode: "full", provider: "zai"
        )
        let payload = UsagePayload(
            five_hour: UsagePayload.Window(utilization: 45, resets_at: nil),
            seven_day: UsagePayload.Window(utilization: 15, resets_at: nil),
            seven_day_sonnet: nil, extra_usage: nil, balance: nil, meta: meta
        )
        model.update(from: payload)

        XCTAssertTrue(model.text.hasSuffix("%wz"), "Expected text to end with %wz, got: \(model.text)")
        XCTAssertTrue(model.tooltip.contains("Provider: zai"))
    }

    func testOpenRouterBalanceOnlyTextAndTooltip() {
        let model = UsageModel()
        let meta = UsagePayload.Meta(
            plan: nil, fetchedAt: nil, tokenSource: nil, version: nil,
            protocolVersion: 2, autoCheckUpdates: nil, displayMode: "full", provider: "openrouter"
        )
        let balance = UsagePayload.Balance(
            currency: "USD", total_cents: 10000, used_cents: 5297, remaining_cents: nil, percentage: nil
        )
        let payload = UsagePayload(
            five_hour: nil, seven_day: nil, seven_day_sonnet: nil, extra_usage: nil,
            balance: balance, meta: meta
        )
        model.update(from: payload)

        XCTAssertEqual(model.text, "\u{2726} --o")
        XCTAssertTrue(model.tooltip.contains("Provider: openrouter"))
        XCTAssertTrue(model.tooltip.contains("Balance: $52.97 / $100.00"))
        XCTAssertFalse(model.text.contains("$"))
        XCTAssertFalse(model.text.contains("52"))
    }

    func testUnlimitedBalanceTooltipShowsUsedOnly() {
        let model = UsageModel()
        let meta = UsagePayload.Meta(
            plan: nil, fetchedAt: nil, tokenSource: nil, version: nil,
            protocolVersion: 2, autoCheckUpdates: nil, displayMode: "full", provider: "openrouter"
        )
        let balance = UsagePayload.Balance(
            currency: "USD", total_cents: nil, used_cents: 1234, remaining_cents: nil, percentage: nil
        )
        let payload = UsagePayload(
            five_hour: nil, seven_day: nil, seven_day_sonnet: nil, extra_usage: nil,
            balance: balance, meta: meta
        )
        model.update(from: payload)

        XCTAssertTrue(model.tooltip.contains("Balance: $12.34 used"))
    }

    func testProviderIndicatorMapping() {
        XCTAssertEqual(UsageModel.providerIndicator("anthropic"), "")
        XCTAssertEqual(UsageModel.providerIndicator(""), "")
        XCTAssertEqual(UsageModel.providerIndicator("zai"), "z")
        XCTAssertEqual(UsageModel.providerIndicator("minimax"), "m")
        XCTAssertEqual(UsageModel.providerIndicator("openrouter"), "o")
        XCTAssertEqual(UsageModel.providerIndicator("komilion"), "k")
        XCTAssertEqual(UsageModel.providerIndicator("packy"), "p")
        XCTAssertEqual(UsageModel.providerIndicator("unknown"), "?")
    }

    func testProviderSnapshotIncludesProviderField() throws {
        let tmp = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("aigauge-test-\(UUID().uuidString).json")
        defer { try? FileManager.default.removeItem(at: tmp) }

        setenv("AIGAUGE_MENU_STATE_PATH", tmp.path, 1)
        defer { unsetenv("AIGAUGE_MENU_STATE_PATH") }

        let model = UsageModel()
        model.applyTestProvider("zai", fiveHour: 45, sevenDay: 15)

        let data = try Data(contentsOf: tmp)
        let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        XCTAssertEqual(obj?["provider"] as? String, "zai")
        XCTAssertNotNil(obj?["menubarText"])
        XCTAssertNotNil(obj?["tooltip"])
    }
}
