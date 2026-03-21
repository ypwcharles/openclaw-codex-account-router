import { describe, expect, it } from "vitest";
import { resolveIntegrationPaths } from "../../src/integration/paths.js";
import { renderOpenClawShim } from "../../src/integration/shim.js";

describe("integration paths", () => {
  it("builds managed bin and service paths under the user home", () => {
    const paths = resolveIntegrationPaths("/Users/tester", "darwin");
    expect(paths.installRoot).toBe("/Users/tester/.openclaw-router");
    expect(paths.binDir).toContain(".openclaw-router");
    expect(paths.shimPath.endsWith("/openclaw")).toBe(true);
    expect(paths.servicePath.endsWith("openclaw-router-repair.plist")).toBe(true);
  });
});

describe("openclaw shim", () => {
  it("forwards to openclaw-router runtime entrypoint", () => {
    const text = renderOpenClawShim({
      routerCommand: "/Users/tester/.openclaw-router/bin/openclaw-router",
      integrationStatePath: "/Users/tester/.openclaw-router/integration.json"
    });

    expect(text).toContain("openclaw-router");
    expect(text).toContain("exec");
    expect(text).toContain("integration.json");
  });

  it("fails fast when integration state points back to the shim", () => {
    const text = renderOpenClawShim({
      routerCommand: "/Users/tester/.openclaw-router/bin/openclaw-router",
      integrationStatePath: "/Users/tester/.openclaw-router/integration.json"
    });

    expect(text).toContain('SHIM_PATH="$0"');
    expect(text).toContain('if [ "$REAL_OPENCLAW" = "$SHIM_PATH" ]; then');
    expect(text).toContain("misconfigured: realOpenClawPath points to shim");
  });
});
