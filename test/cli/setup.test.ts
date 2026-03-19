import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runSetup } from "../../src/integration/setup.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(cleanupPaths.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

describe("setup flow", () => {
  it("discovers codex profiles and installs integration artifacts", async () => {
    const homeDir = await mkdtemp(path.join(tmpdir(), "setup-flow-"));
    cleanupPaths.push(homeDir);

    const authStorePath = path.join(homeDir, ".openclaw", "agents", "main", "agent", "auth-profiles.json");
    await mkdir(path.dirname(authStorePath), { recursive: true });
    await writeFile(
      authStorePath,
      JSON.stringify(
        {
          version: 1,
          profiles: {
            "openai-codex:a@example.com": {
              provider: "openai-codex",
              access: "a"
            },
            "openai-codex:b@example.com": {
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

    const result = await runSetup(
      {
        homeDir,
        platform: "linux",
        authStorePath
      },
      {
        discoverOpenClawProfiles: async () => [
          "openai-codex:a@example.com",
          "openai-codex:b@example.com"
        ],
        resolveOpenClawBinary: async () => "/usr/bin/openclaw",
        now: () => new Date("2026-03-19T12:00:00.000Z")
      }
    );

    expect(result.installed).toBe(true);
    expect(result.discoveredProfiles.length).toBe(2);

    await access(result.shimPath);
    await access(result.servicePath);

    const state = JSON.parse(await readFile(result.integrationStatePath, "utf8")) as {
      realOpenClawPath: string;
    };
    expect(state.realOpenClawPath).toBe("/usr/bin/openclaw");
  });
});
