import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runWithCodexPool } from "../../src/router/run_with_codex_pool.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(cleanupPaths.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

describe("requirements acceptance", () => {
  it("scenario 1: usage limit stays inside codex pool", async () => {
    const fixture = await makeFixture();
    const execOpenClaw = vi
      .fn()
      .mockRejectedValueOnce(new Error("You have hit your ChatGPT usage limit (team plan)"))
      .mockResolvedValueOnce({ exitCode: 0, stdout: "ok", stderr: "" });

    const result = await runWithCodexPool({
      routerStatePath: fixture.routerStatePath,
      authStorePath: fixture.authStorePath,
      command: "openclaw",
      args: ["agent"],
      execOpenClaw,
      now: () => new Date("2026-03-19T12:00:00.000Z")
    });

    expect(result.poolExhausted).toBe(false);
    expect(result.usedProfileIds.length).toBe(2);
  });

  it("scenario 2: deactivated workspace disables current account", async () => {
    const fixture = await makeFixture();
    const execOpenClaw = vi
      .fn()
      .mockRejectedValueOnce(new Error('{"detail":{"code":"deactivated_workspace"}}'))
      .mockResolvedValueOnce({ exitCode: 0, stdout: "ok", stderr: "" });

    const result = await runWithCodexPool({
      routerStatePath: fixture.routerStatePath,
      authStorePath: fixture.authStorePath,
      command: "openclaw",
      args: ["agent"],
      execOpenClaw,
      now: () => new Date("2026-03-19T12:00:00.000Z")
    });

    const state = JSON.parse(await readFile(fixture.routerStatePath, "utf8")) as {
      accounts: Array<{ alias: string; status: string }>;
    };

    expect(result.poolExhausted).toBe(false);
    expect(state.accounts.find((item) => item.alias === "acct-a")?.status).toBe("disabled");
  });

  it("scenario 3: exhausted codex pool permits minimax fallback", async () => {
    const fixture = await makeFixture();
    const execOpenClaw = vi
      .fn()
      .mockRejectedValue(new Error("You have hit your ChatGPT usage limit (team plan)"));

    const result = await runWithCodexPool({
      routerStatePath: fixture.routerStatePath,
      authStorePath: fixture.authStorePath,
      command: "openclaw",
      args: ["agent"],
      execOpenClaw,
      now: () => new Date("2026-03-19T12:00:00.000Z")
    });

    expect(result.poolExhausted).toBe(true);
    expect(result.lastError).toContain("usage limit");
  });
});

async function makeFixture(): Promise<{ routerStatePath: string; authStorePath: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), "acceptance-"));
  cleanupPaths.push(dir);
  const routerStatePath = path.join(dir, "router-state.json");
  const authStorePath = path.join(dir, "auth-profiles.json");

  await writeFile(
    routerStatePath,
    JSON.stringify(
      {
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
      },
      null,
      2
    ),
    "utf8"
  );

  await writeFile(
    authStorePath,
    JSON.stringify(
      {
        version: 1,
        profiles: {
          "openai-codex:a@example.com": { type: "oauth", provider: "openai-codex", access: "a" },
          "openai-codex:b@example.com": { type: "oauth", provider: "openai-codex", access: "b" }
        },
        order: {},
        usageStats: {}
      },
      null,
      2
    ),
    "utf8"
  );

  return { routerStatePath, authStorePath };
}
