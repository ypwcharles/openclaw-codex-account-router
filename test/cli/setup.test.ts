import { access, chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { execa } from "execa";
import { fileURLToPath } from "node:url";
import { runSetup } from "../../src/integration/setup.js";

const cleanupPaths: string[] = [];
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function buildAccessTokenWithEmail(email: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      "https://api.openai.com/profile": { email }
    })
  ).toString("base64url");
  return `${header}.${payload}.signature`;
}

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
    const originalAuthStoreRaw = JSON.stringify(
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
    );
    await writeFile(authStorePath, originalAuthStoreRaw, "utf8");

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
      authStoreBackupPath?: string;
    };
    expect(state.realOpenClawPath).toBe("/usr/bin/openclaw");
    expect(state.authStoreBackupPath).toBeDefined();
    if (state.authStoreBackupPath) {
      const backupRaw = await readFile(state.authStoreBackupPath, "utf8");
      expect(JSON.parse(backupRaw)).toEqual(JSON.parse(originalAuthStoreRaw));
    }
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

  it("refreshes auth backup on every setup rerun", async () => {
    const homeDir = await mkdtemp(path.join(tmpdir(), "setup-rerun-backup-"));
    cleanupPaths.push(homeDir);

    const authStorePath = path.join(homeDir, ".openclaw", "agents", "main", "agent", "auth-profiles.json");
    await mkdir(path.dirname(authStorePath), { recursive: true });

    const firstAuthStoreRaw = JSON.stringify(
      {
        version: 1,
        profiles: {
          "openai-codex:a1@example.com": { provider: "openai-codex", access: "a1" }
        },
        order: {},
        usageStats: {}
      },
      null,
      2
    );
    await writeFile(authStorePath, firstAuthStoreRaw, "utf8");

    await runSetup(
      {
        homeDir,
        platform: "linux",
        authStorePath
      },
      {
        discoverOpenClawProfiles: async () => ["openai-codex:a1@example.com"],
        resolveOpenClawBinary: async () => "/usr/bin/openclaw"
      }
    );

    const secondAuthStoreRaw = JSON.stringify(
      {
        version: 1,
        profiles: {
          "openai-codex:a2@example.com": { provider: "openai-codex", access: "a2" },
          "openai-codex:b2@example.com": { provider: "openai-codex", access: "b2" }
        },
        order: {},
        usageStats: {}
      },
      null,
      2
    );
    await writeFile(authStorePath, secondAuthStoreRaw, "utf8");

    const secondSetup = await runSetup(
      {
        homeDir,
        platform: "linux",
        authStorePath
      },
      {
        discoverOpenClawProfiles: async () => [
          "openai-codex:a2@example.com",
          "openai-codex:b2@example.com"
        ],
        resolveOpenClawBinary: async () => "/usr/bin/openclaw"
      }
    );

    const integrationStateRaw = await readFile(secondSetup.integrationStatePath, "utf8");
    const integrationState = JSON.parse(integrationStateRaw) as { authStoreBackupPath?: string };
    expect(integrationState.authStoreBackupPath).toBeDefined();
    if (!integrationState.authStoreBackupPath) {
      throw new Error("authStoreBackupPath is required");
    }

    const backupRaw = await readFile(integrationState.authStoreBackupPath, "utf8");
    expect(JSON.parse(backupRaw)).toEqual(JSON.parse(secondAuthStoreRaw));
  });

  it("prefers dist launcher entry for projectRoot installs", async () => {
    const homeDir = await mkdtemp(path.join(tmpdir(), "setup-project-root-dist-"));
    const projectRoot = await mkdtemp(path.join(tmpdir(), "setup-project-root-src-"));
    cleanupPaths.push(homeDir, projectRoot);

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

    const sourceEntry = path.join(projectRoot, "src", "cli", "main.ts");
    const distEntry = path.join(projectRoot, "dist", "src", "cli", "main.js");
    await mkdir(path.dirname(sourceEntry), { recursive: true });
    await mkdir(path.dirname(distEntry), { recursive: true });
    await writeFile(sourceEntry, "export {}\n", "utf8");
    await writeFile(distEntry, "console.log('ok')\n", "utf8");

    await runSetup(
      {
        homeDir,
        platform: "linux",
        authStorePath,
        projectRoot
      },
      {
        discoverOpenClawProfiles: async () => ["openai-codex:a@example.com"],
        resolveOpenClawBinary: async () => "/usr/bin/openclaw"
      }
    );

    const launcherPath = path.join(homeDir, ".openclaw-router", "bin", "openclaw-router");
    const launcherText = await readFile(launcherPath, "utf8");
    expect(launcherText).toContain(distEntry);
    expect(launcherText).not.toContain("--import tsx");
  });

  it("migrates default codex oauth profiles to email-based ids during setup", async () => {
    const homeDir = await mkdtemp(path.join(tmpdir(), "setup-migrate-default-"));
    cleanupPaths.push(homeDir);

    const routerStatePath = path.join(homeDir, ".openclaw-router", "router-state.json");
    const authStorePath = path.join(homeDir, ".openclaw", "agents", "main", "agent", "auth-profiles.json");
    await mkdir(path.dirname(authStorePath), { recursive: true });

    const originalAuthStoreRaw = JSON.stringify(
      {
        version: 1,
        profiles: {
          "openai-codex:default": {
            provider: "openai-codex",
            access: buildAccessTokenWithEmail("decoded@example.com"),
            refresh: "refresh-default"
          }
        },
        order: {
          "openai-codex": ["openai-codex:default"]
        },
        lastGood: {
          "openai-codex": "openai-codex:default"
        },
        usageStats: {
          "openai-codex:default": {
            cooldownUntil: 9_999_999_999_999
          }
        }
      },
      null,
      2
    );
    await writeFile(authStorePath, originalAuthStoreRaw, "utf8");
    await mkdir(path.dirname(routerStatePath), { recursive: true });

    await writeFile(
      routerStatePath,
      JSON.stringify(
        {
          version: 1,
          accounts: [
            {
              alias: "acct-a",
              profileId: "openai-codex:default",
              provider: "openai-codex",
              priority: 10,
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

    const result = await runSetup(
      {
        homeDir,
        platform: "linux",
        authStorePath,
        routerStatePath
      },
      {
        resolveOpenClawBinary: async () => "/usr/bin/openclaw"
      }
    );

    expect(result.discoveredProfiles).toEqual(["openai-codex:decoded@example.com"]);

    const authStore = JSON.parse(await readFile(authStorePath, "utf8")) as {
      profiles: Record<string, unknown>;
      order?: Record<string, string[]>;
      lastGood?: Record<string, string>;
      usageStats?: Record<string, unknown>;
    };
    expect(authStore.profiles["openai-codex:decoded@example.com"]).toBeDefined();
    expect(authStore.profiles["openai-codex:default"]).toBeUndefined();
    expect(authStore.order?.["openai-codex"]).toEqual(["openai-codex:decoded@example.com"]);
    expect(authStore.lastGood?.["openai-codex"]).toBe("openai-codex:decoded@example.com");
    expect(authStore.usageStats?.["openai-codex:decoded@example.com"]).toBeDefined();
    expect(authStore.usageStats?.["openai-codex:default"]).toBeUndefined();

    const routerState = JSON.parse(await readFile(routerStatePath, "utf8")) as {
      accounts: Array<{ alias: string; profileId: string }>;
    };
    expect(routerState.accounts).toHaveLength(1);
    expect(routerState.accounts[0]).toMatchObject({
      alias: "acct-a",
      profileId: "openai-codex:decoded@example.com"
    });

    const integrationStateRaw = await readFile(result.integrationStatePath, "utf8");
    const integrationState = JSON.parse(integrationStateRaw) as { authStoreBackupPath?: string };
    expect(integrationState.authStoreBackupPath).toBeDefined();
    if (!integrationState.authStoreBackupPath) {
      throw new Error("authStoreBackupPath is required");
    }
    const backupRaw = await readFile(integrationState.authStoreBackupPath, "utf8");
    expect(JSON.parse(backupRaw)).toEqual(JSON.parse(originalAuthStoreRaw));
  });
});
