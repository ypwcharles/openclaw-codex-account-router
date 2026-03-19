import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadRouterState, saveRouterState } from "../../src/account_store/store.js";
import type { RouterState } from "../../src/account_store/types.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(cleanupPaths.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

describe("router state store", () => {
  it("round-trips accounts and preserves priority order", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "router-state-"));
    cleanupPaths.push(dir);
    const statePath = path.join(dir, "router-state.json");

    const state: RouterState = {
      version: 1,
      accounts: [
        {
          alias: "acct-a",
          profileId: "openai-codex:a@example.com",
          provider: "openai-codex",
          priority: 10,
          status: "healthy",
          enabled: true
        },
        {
          alias: "acct-b",
          profileId: "openai-codex:b@example.com",
          provider: "openai-codex",
          priority: 20,
          status: "cooldown",
          enabled: true
        }
      ]
    };

    await saveRouterState(statePath, state);
    const loaded = await loadRouterState(statePath);

    expect(loaded.accounts.map((x) => x.alias)).toEqual(["acct-a", "acct-b"]);
    expect(loaded.accounts[1]?.status).toBe("cooldown");
  });

  it("writes valid JSON content", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "router-state-"));
    cleanupPaths.push(dir);
    const statePath = path.join(dir, "router-state.json");

    await saveRouterState(statePath, { version: 1, accounts: [] });
    const raw = await readFile(statePath, "utf8");
    expect(() => JSON.parse(raw)).not.toThrow();
  });
});
