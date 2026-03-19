import { describe, expect, it } from "vitest";
import { renderServiceDefinition } from "../../src/integration/service_templates.js";

describe("service templates", () => {
  it("renders a launchd plist for macOS", () => {
    const text = renderServiceDefinition({
      platform: "darwin",
      installRoot: "/Users/tester/.openclaw-router"
    });

    expect(text).toContain("<plist");
    expect(text).toContain("openclaw-router");
  });

  it("renders a systemd user unit for linux", () => {
    const text = renderServiceDefinition({
      platform: "linux",
      installRoot: "/home/tester/.openclaw-router"
    });

    expect(text).toContain("[Unit]");
    expect(text).toContain("ExecStart=");
    expect(text).toContain("openclaw-router");
  });
});
