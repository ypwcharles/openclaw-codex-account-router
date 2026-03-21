import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runWithCodexPool } from "../../src/router/run_with_codex_pool.js";
import type { RouterState } from "../../src/account_store/types.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(cleanupPaths.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

describe("runWithCodexPool", () => {
  it("cooldowns account A and retries with account B before pool exhaustion", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "codex-pool-"));
    cleanupPaths.push(dir);
    const routerStatePath = path.join(dir, "router-state.json");
    const authStorePath = path.join(dir, "auth-profiles.json");

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
          status: "healthy",
          enabled: true
        }
      ]
    };
    await writeFile(routerStatePath, JSON.stringify(state, null, 2), "utf8");
    await writeFile(
      authStorePath,
      JSON.stringify(
        {
          version: 1,
          profiles: {
            "openai-codex:a@example.com": {
              type: "oauth",
              provider: "openai-codex",
              access: "a"
            },
            "openai-codex:b@example.com": {
              type: "oauth",
              provider: "openai-codex",
              access: "b"
            }
          },
          order: {},
          usageStats: {}
        },
        null,
        2
      ),
      "utf8"
    );

    const execOpenClaw = vi
      .fn()
      .mockRejectedValueOnce(new Error("You have hit your ChatGPT usage limit (team plan)"))
      .mockResolvedValueOnce({ exitCode: 0, stdout: "ok", stderr: "" });

    const result = await runWithCodexPool({
      routerStatePath,
      authStorePath,
      command: "openclaw",
      args: ["agent"],
      execOpenClaw,
      now: () => new Date("2026-03-19T12:00:00.000Z")
    });

    expect(result.poolExhausted).toBe(false);
    expect(result.usedProfileIds).toEqual([
      "openai-codex:a@example.com",
      "openai-codex:b@example.com"
    ]);

    const routerState = JSON.parse(await readFile(routerStatePath, "utf8")) as {
      accounts: Array<{ alias: string; cooldownUntil?: string }>;
    };
    const authStore = JSON.parse(await readFile(authStorePath, "utf8")) as {
      lastGood?: Record<string, string>;
      usageStats?: Record<string, { cooldownUntil?: number; lastUsed?: number; errorCount?: number }>;
    };
    const routerCooldown = routerState.accounts.find((x) => x.alias === "acct-a")?.cooldownUntil;
    const mirroredCooldown = authStore.usageStats?.["openai-codex:a@example.com"]?.cooldownUntil;
    expect(routerCooldown).toBeDefined();
    expect(mirroredCooldown).toBeDefined();
    expect(new Date(routerCooldown ?? "").getTime()).toBe(mirroredCooldown);
    expect(authStore.lastGood?.["openai-codex"]).toBe("openai-codex:b@example.com");
    expect(authStore.usageStats?.["openai-codex:b@example.com"]?.lastUsed).toBe(
      Date.parse("2026-03-19T12:00:00.000Z")
    );
    expect(authStore.usageStats?.["openai-codex:b@example.com"]?.errorCount).toBe(0);
  });

  it("mirrors timeout retry escalation as timeout instead of rate_limit", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "codex-pool-"));
    cleanupPaths.push(dir);
    const routerStatePath = path.join(dir, "router-state.json");
    const authStorePath = path.join(dir, "auth-profiles.json");

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
          status: "healthy",
          enabled: true
        }
      ]
    };
    await writeFile(routerStatePath, JSON.stringify(state, null, 2), "utf8");
    await writeFile(
      authStorePath,
      JSON.stringify(
        {
          version: 1,
          profiles: {
            "openai-codex:a@example.com": {
              type: "oauth",
              provider: "openai-codex",
              access: "a"
            },
            "openai-codex:b@example.com": {
              type: "oauth",
              provider: "openai-codex",
              access: "b"
            }
          },
          order: {},
          usageStats: {}
        },
        null,
        2
      ),
      "utf8"
    );

    const execOpenClaw = vi
      .fn()
      .mockRejectedValueOnce(new Error("request timed out"))
      .mockRejectedValueOnce(new Error("request timed out"))
      .mockResolvedValueOnce({ exitCode: 0, stdout: "ok", stderr: "" });

    const result = await runWithCodexPool({
      routerStatePath,
      authStorePath,
      command: "openclaw",
      args: ["agent"],
      execOpenClaw,
      now: () => new Date("2026-03-19T12:00:00.000Z")
    });

    const authStore = JSON.parse(await readFile(authStorePath, "utf8")) as {
      usageStats?: Record<string, { failureCounts?: Record<string, number> }>;
    };
    const usage = authStore.usageStats?.["openai-codex:a@example.com"];
    expect(result.poolExhausted).toBe(false);
    expect(result.usedProfileIds).toEqual([
      "openai-codex:a@example.com",
      "openai-codex:a@example.com",
      "openai-codex:b@example.com"
    ]);
    expect(usage?.failureCounts?.["timeout"]).toBe(1);
    expect(usage?.failureCounts?.["rate_limit"]).toBeUndefined();
  });
});
