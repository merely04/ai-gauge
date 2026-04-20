import { describe, test, expect } from "bun:test";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..");
const VALIDATOR = join(REPO_ROOT, "scripts", "validate-release.sh");
const FIXTURES = join(REPO_ROOT, "test", "fixtures", "validate-release");

async function runValidator({ fixture, args = [], extraEnv = {} }) {
  const proc = Bun.spawn({
    cmd: ["bash", VALIDATOR, ...args],
    env: {
      ...process.env,
      AIGAUGE_REPO_ROOT: join(FIXTURES, fixture),
      ...extraEnv,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { exitCode, stdout, stderr };
}

describe("validate-release.sh", () => {
  test("good fixture exits 0", async () => {
    const { exitCode, stdout } = await runValidator({ fixture: "good" });
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/OK.*9\.9\.9/);
  });

  test("bad-app-plist exits 1 with diff line for bin/AIGauge.app", async () => {
    const { exitCode, stderr } = await runValidator({ fixture: "bad-app-plist" });
    expect(exitCode).toBe(1);
    expect(stderr).toContain("bin/AIGauge.app/Contents/Info.plist");
    expect(stderr).toContain("9.9.9");
    expect(stderr).toContain("9.9.8");
  });

  test("bad-source-plist exits 1 with diff line for macos/.../Info.plist", async () => {
    const { exitCode, stderr } = await runValidator({ fixture: "bad-source-plist" });
    expect(exitCode).toBe(1);
    expect(stderr).toContain("macos/AIGauge/Sources/AIGauge/Info.plist");
  });

  test("bad-changelog-missing exits 1", async () => {
    const { exitCode, stderr } = await runValidator({ fixture: "bad-changelog-missing" });
    expect(exitCode).toBe(1);
    expect(stderr).toContain("CHANGELOG.md");
  });

  test("bad-changelog-no-date exits 1", async () => {
    const { exitCode, stderr } = await runValidator({ fixture: "bad-changelog-no-date" });
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/CHANGELOG\.md|YYYY-MM-DD/);
  });

  test("good-hyphen exits 0 (ASCII hyphen accepted)", async () => {
    const { exitCode } = await runValidator({ fixture: "good-hyphen" });
    expect(exitCode).toBe(0);
  });

  test("missing-package-json exits 2", async () => {
    const { exitCode, stderr } = await runValidator({ fixture: "missing-package-json" });
    expect(exitCode).toBe(2);
    expect(stderr).toContain("package.json");
  });

  test("missing-app-plist exits 2", async () => {
    const { exitCode, stderr } = await runValidator({ fixture: "missing-app-plist" });
    expect(exitCode).toBe(2);
    expect(stderr).toContain("bin/AIGauge.app/Contents/Info.plist");
  });

  test("--tag v9.9.9 against good exits 0", async () => {
    const { exitCode } = await runValidator({
      fixture: "good",
      args: ["--tag", "v9.9.9"],
    });
    expect(exitCode).toBe(0);
  });

  test("--tag v9.9.8 against good exits 1", async () => {
    const { exitCode, stderr } = await runValidator({
      fixture: "good",
      args: ["--tag", "v9.9.8"],
    });
    expect(exitCode).toBe(1);
    expect(stderr).toContain("tag");
  });

  test("--tag malformed (v9.9) exits 1", async () => {
    const { exitCode, stderr } = await runValidator({
      fixture: "good",
      args: ["--tag", "v9.9"],
    });
    expect(exitCode).toBe(1);
    expect(stderr).toContain("is not vX.Y.Z");
  });

  test("absence of --tag does not error on tag check", async () => {
    const { exitCode } = await runValidator({ fixture: "good" });
    expect(exitCode).toBe(0);
  });

  test("emits diff-style output with - and + markers for mismatches", async () => {
    const { stderr } = await runValidator({ fixture: "bad-app-plist" });
    expect(stderr).toMatch(/^\s*-\s+\S+/m);
    expect(stderr).toMatch(/^\s*\+\s+\S+/m);
  });
});
