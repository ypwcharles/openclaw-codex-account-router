import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runRouterCommand } from "../../src/cli/commands/run.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(cleanupPaths.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

describe("run cli command", () => {
  it("returns success when codex pool recovers on second account", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "run-cli-"));
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

    const execOpenClaw = vi
      .fn()
      .mockRejectedValueOnce(new Error("You have hit your ChatGPT usage limit (team plan)"))
      .mockResolvedValueOnce({ exitCode: 0, stdout: "ok", stderr: "" });

    const result = await runRouterCommand(
      {
        routerStatePath,
        authStorePath,
        command: "openclaw",
        args: ["agent"]
      },
      { execOpenClaw, now: () => new Date("2026-03-19T12:00:00.000Z") }
    );

    expect(result.poolExhausted).toBe(false);
    expect(result.usedProfileIds).toEqual([
      "openai-codex:a@example.com",
      "openai-codex:b@example.com"
    ]);
  });
});
