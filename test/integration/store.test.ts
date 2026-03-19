import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadIntegrationState, saveIntegrationState } from "../../src/integration/store.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(cleanupPaths.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

describe("integration state store", () => {
  it("round-trips integration metadata", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "integration-store-"));
    cleanupPaths.push(dir);
    const statePath = path.join(dir, "router-install.json");

    const state = {
      version: 1 as const,
      platform: "darwin" as const,
      installRoot: "/tmp/router",
      shimPath: "/tmp/router/bin/openclaw",
      realOpenClawPath: "/usr/local/bin/openclaw",
      servicePath: "/tmp/router/service.plist",
      lastSetupAt: "2026-03-19T10:00:00.000Z"
    };

    await saveIntegrationState(statePath, state);
    const loaded = await loadIntegrationState(statePath);

    expect(loaded).toBeDefined();
    if (!loaded) {
      throw new Error("expected integration state to be present");
    }
    expect(loaded.realOpenClawPath).toBe("/usr/local/bin/openclaw");

    const raw = await readFile(statePath, "utf8");
    expect(raw.endsWith("\n")).toBe(true);
  });
});
