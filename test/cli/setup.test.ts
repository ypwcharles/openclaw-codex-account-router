import { access, chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { execa } from "execa";
import { fileURLToPath } from "node:url";
import { runSetup } from "../../src/integration/setup.js";

const cleanupPaths: string[] = [];
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

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

  it("creates a managed launcher that works even when setup runs outside repo root", async () => {
    const homeDir = await mkdtemp(path.join(tmpdir(), "setup-cwd-"));
    const foreignCwd = await mkdtemp(path.join(tmpdir(), "setup-foreign-cwd-"));
    cleanupPaths.push(homeDir, foreignCwd);

    const authStorePath = path.join(homeDir, ".openclaw", "agents", "main", "agent", "auth-profiles.json");
    await mkdir(path.dirname(authStorePath), { recursive: true });
    await writeFile(
      authStorePath,
      JSON.stringify(
        {
          version: 1,
          profiles: {
            "openai-codex:a@example.com": { provider: "openai-codex", access: "a" }
          }
        },
        null,
        2
      ),
      "utf8"
    );

    const realBinDir = path.join(homeDir, "real-bin");
    const realOpenClawPath = path.join(realBinDir, "openclaw");
    await mkdir(realBinDir, { recursive: true });
    await writeFile(realOpenClawPath, "#!/usr/bin/env bash\nexit 0\n", "utf8");
    await chmod(realOpenClawPath, 0o755);

    const originalCwd = process.cwd();
    try {
      process.chdir(foreignCwd);
      await runSetup(
        {
          homeDir,
          platform: "linux",
          authStorePath
        },
        {
          discoverOpenClawProfiles: async () => ["openai-codex:a@example.com"],
          resolveOpenClawBinary: async () => realOpenClawPath
        }
      );
    } finally {
      process.chdir(originalCwd);
    }

    const launcherPath = path.join(homeDir, ".openclaw-router", "bin", "openclaw-router");
    const launcherText = await readFile(launcherPath, "utf8");
    expect(launcherText).not.toContain(path.join(foreignCwd, "src", "cli", "main.ts"));

    const { stdout } = await execa(launcherPath, ["--help"], { cwd: foreignCwd, env: process.env });
    expect(stdout).toContain("Usage: openclaw-router");
    expect(stdout).toContain("setup");
  });
});
