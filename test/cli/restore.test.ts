import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runSetup } from "../../src/integration/setup.js";
import { runRestore } from "../../src/integration/restore.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(cleanupPaths.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

describe("restore flow", () => {
  it("restores auth store from setup backup", async () => {
    const homeDir = await mkdtemp(path.join(tmpdir(), "restore-flow-"));
    cleanupPaths.push(homeDir);

    const authStorePath = path.join(homeDir, ".openclaw", "agents", "main", "agent", "auth-profiles.json");
    await mkdir(path.dirname(authStorePath), { recursive: true });

    const originalAuth = JSON.stringify(
      {
        version: 1,
        profiles: {
          "openai-codex:a@example.com": { provider: "openai-codex", access: "a" }
        },
        order: {},
        usageStats: {}
      },
      null,
      2
    );
    await writeFile(authStorePath, originalAuth, "utf8");

    const setupResult = await runSetup(
      {
        homeDir,
        platform: "linux",
        authStorePath
      },
      {
        discoverOpenClawProfiles: async () => ["openai-codex:a@example.com"],
        resolveOpenClawBinary: async () => "/usr/bin/openclaw"
      }
    );

    await writeFile(
      authStorePath,
      JSON.stringify(
        {
          version: 1,
          profiles: {},
          order: { "openai-codex": [] },
          usageStats: {}
        },
        null,
        2
      ),
      "utf8"
    );

    const result = await runRestore({
      integrationStatePath: setupResult.integrationStatePath
    });
    const restoredRaw = await readFile(authStorePath, "utf8");

    expect(result.restored).toBe(true);
    expect(result.authStorePath).toBe(authStorePath);
    expect(JSON.parse(restoredRaw)).toEqual(JSON.parse(originalAuth));
  });

  it("preserves the original setup backup across repeated setup runs", async () => {
    const homeDir = await mkdtemp(path.join(tmpdir(), "restore-flow-repeat-"));
    cleanupPaths.push(homeDir);

    const authStorePath = path.join(homeDir, ".openclaw", "agents", "main", "agent", "auth-profiles.json");
    await mkdir(path.dirname(authStorePath), { recursive: true });

    const originalAuth = JSON.stringify(
      {
        version: 1,
        profiles: {
          "openai-codex:a@example.com": { provider: "openai-codex", access: "a" }
        },
        order: {},
        usageStats: {}
      },
      null,
      2
    );
    await writeFile(authStorePath, originalAuth, "utf8");

    const deps = {
      discoverOpenClawProfiles: async () => ["openai-codex:a@example.com"],
      resolveOpenClawBinary: async () => "/usr/bin/openclaw"
    };

    const setupResult = await runSetup(
      {
        homeDir,
        platform: "linux",
        authStorePath
      },
      deps
    );

    await writeFile(
      authStorePath,
      JSON.stringify(
        {
          version: 1,
          profiles: {
            "openai-codex:a@example.com": { provider: "openai-codex", access: "mutated" }
          },
          order: { "openai-codex": ["openai-codex:a@example.com"] },
          usageStats: {
            "openai-codex:a@example.com": {
              lastUsedAt: "2026-03-20T00:00:00.000Z"
            }
          }
        },
        null,
        2
      ),
      "utf8"
    );

    await runSetup(
      {
        homeDir,
        platform: "linux",
        authStorePath
      },
      deps
    );

    const result = await runRestore({
      integrationStatePath: setupResult.integrationStatePath
    });
    const restoredRaw = await readFile(authStorePath, "utf8");

    expect(result.restored).toBe(true);
    expect(JSON.parse(restoredRaw)).toEqual(JSON.parse(originalAuth));
  });
});
