import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { execa } from "execa";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cleanupPaths: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(cleanupPaths.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

describe("status cli", () => {
  it("shows integration health along with routing health", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "status-cli-"));
    cleanupPaths.push(dir);
    const routerStatePath = path.join(dir, "router-state.json");
    const integrationStatePath = path.join(dir, "integration.json");

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
              status: "cooldown",
              enabled: true,
              cooldownUntil: "2020-01-01T00:00:00.000Z"
            },
            {
              alias: "acct-b",
              profileId: "openai-codex:b@example.com",
              provider: "openai-codex",
              priority: 20,
              status: "healthy",
              enabled: true
            },
            {
              alias: "acct-c",
              profileId: "openai-codex:c@example.com",
              provider: "openai-codex",
              priority: 30,
              status: "cooldown",
              enabled: true,
              cooldownUntil: "2099-01-01T00:00:00.000Z"
            }
          ],
          lastProviderFallbackReason: "Codex account pool exhausted"
        },
        null,
        2
      ),
      "utf8"
    );

    await writeFile(
      integrationStatePath,
      JSON.stringify(
        {
          version: 1,
          platform: "linux",
          installRoot: dir,
          shimPath: path.join(dir, "bin", "openclaw"),
          realOpenClawPath: "/usr/bin/openclaw",
          servicePath: path.join(dir, "services", "openclaw-router-repair.service"),
          lastSetupAt: "2026-03-19T10:00:00.000Z"
        },
        null,
        2
      ),
      "utf8"
    );

    const { stdout } = await execa(
      "node",
      [
        "--import",
        "tsx",
        "src/cli/main.ts",
        "status",
        "--router-state",
        routerStatePath,
        "--integration-state",
        integrationStatePath,
        "--json"
      ],
      { cwd: repoRoot }
    );

    const payload = JSON.parse(stdout) as {
      currentOrder: string[];
      nextCandidate?: string;
      lastProviderFallbackReason?: string;
      cooldowns: Array<{ alias: string; until?: string }>;
      accounts: Array<{ alias: string; effectiveStatus: string; selected: boolean }>;
      integration: {
        installed: boolean;
        shimPath?: string;
        realOpenClawPath?: string;
      };
    };

    expect(payload.currentOrder).toEqual(["acct-a", "acct-b", "acct-c"]);
    expect(payload.cooldowns).toEqual([
      { alias: "acct-c", until: "2099-01-01T00:00:00.000Z" }
    ]);
    expect(payload.nextCandidate).toBe("acct-a");
    expect(payload.accounts.find((account) => account.alias === "acct-a")?.selected).toBe(true);
    expect(payload.lastProviderFallbackReason).toBe("Codex account pool exhausted");
    expect(payload.integration.installed).toBe(true);
    expect(payload.integration.shimPath).toContain("openclaw");
    expect(payload.integration.realOpenClawPath).toBe("/usr/bin/openclaw");
  });

  it("merges upstream auth-store cooldown into status selection", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "status-cli-auth-"));
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
          lastGood: {
            "openai-codex": "openai-codex:a@example.com"
          },
          usageStats: {
            "openai-codex:a@example.com": {
              cooldownUntil: Date.parse("2099-01-01T00:00:00.000Z"),
              retryUntil: Date.parse("2099-01-01T00:00:00.000Z"),
              retryReason: "rate_limit",
              retryCount: 1,
              failureCounts: {
                rate_limit: 1
              },
              lastFailureAt: Date.parse("2026-03-21T10:05:43.701Z"),
              quotaSource: "usage_api",
              quotaFetchedAt: Date.parse("2026-03-21T10:00:00.000Z"),
              planType: "team",
              limitReached: true,
              primaryUsedPercent: 100,
              primaryRemainingPercent: 0,
              primaryWindowMinutes: 300,
              primaryResetAt: Date.parse("2099-01-01T00:00:00.000Z"),
              secondaryUsedPercent: 40,
              secondaryRemainingPercent: 60,
              secondaryWindowMinutes: 10080,
              secondaryResetAt: Date.parse("2099-01-07T00:00:00.000Z"),
              quota: {
                source: "usage_api",
                fetchedAt: Date.parse("2026-03-21T10:00:00.000Z"),
                planType: "team",
                limitReached: true,
                primary: {
                  usedPercent: 100,
                  remainingPercent: 0,
                  windowMinutes: 300,
                  resetAt: Date.parse("2099-01-01T00:00:00.000Z")
                },
                secondary: {
                  usedPercent: 40,
                  remainingPercent: 60,
                  windowMinutes: 10080,
                  resetAt: Date.parse("2099-01-07T00:00:00.000Z")
                }
              }
            },
            "openai-codex:b@example.com": {
              lastUsed: Date.parse("2026-03-21T10:02:40.664Z")
            }
          }
        },
        null,
        2
      ),
      "utf8"
    );

    const { stdout } = await execa(
      "node",
      [
        "--import",
        "tsx",
        "src/cli/main.ts",
        "status",
        "--router-state",
        routerStatePath,
        "--auth-store",
        authStorePath,
        "--json"
      ],
      { cwd: repoRoot }
    );

    const payload = JSON.parse(stdout) as {
      nextCandidate?: string;
      authLastGoodProfileId?: string;
      cooldowns: Array<{ alias: string; until?: string }>;
      lastErrorCodes: Array<{ alias: string; code?: string }>;
      accounts: Array<{
        alias: string;
        effectiveStatus: string;
        cooldownUntil?: string;
        retryUntil?: string;
        retryReason?: string;
        selected: boolean;
        quota?: {
          source?: string;
          fetchedAt?: string;
          planType?: string;
          limitReached?: boolean;
          primary?: {
            remainingPercent?: number;
            resetAt?: string;
            windowMinutes?: number;
          };
          secondary?: {
            remainingPercent?: number;
            resetAt?: string;
            windowMinutes?: number;
          };
        };
      }>;
    };

    expect(payload.authLastGoodProfileId).toBe("openai-codex:a@example.com");
    expect(payload.nextCandidate).toBe("acct-b");
    expect(payload.cooldowns).toEqual([
      { alias: "acct-a", until: "2099-01-01T00:00:00.000Z" }
    ]);
    expect(payload.lastErrorCodes.find((item) => item.alias === "acct-a")?.code).toBe("rate_limit");
    expect(payload.accounts.find((account) => account.alias === "acct-a")?.effectiveStatus).toBe(
      "cooldown"
    );
    expect(payload.accounts.find((account) => account.alias === "acct-a")?.retryUntil).toBe(
      "2099-01-01T00:00:00.000Z"
    );
    expect(payload.accounts.find((account) => account.alias === "acct-a")?.retryReason).toBe(
      "rate_limit"
    );
    expect(payload.accounts.find((account) => account.alias === "acct-a")?.quota).toEqual({
      source: "usage_api",
      fetchedAt: "2026-03-21T10:00:00.000Z",
      planType: "team",
      limitReached: true,
      primary: {
        usedPercent: 100,
        remainingPercent: 0,
        resetAt: "2099-01-01T00:00:00.000Z",
        windowMinutes: 300
      },
      secondary: {
        usedPercent: 40,
        remainingPercent: 60,
        resetAt: "2099-01-07T00:00:00.000Z",
        windowMinutes: 10080
      }
    });
    expect(payload.accounts.find((account) => account.alias === "acct-b")?.selected).toBe(true);
  });

  it("falls back to router-only status when auth store is malformed", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "status-cli-bad-auth-"));
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
            }
          ]
        },
        null,
        2
      ),
      "utf8"
    );
    await writeFile(authStorePath, "{broken json", "utf8");

    const { stdout } = await execa(
      "node",
      [
        "--import",
        "tsx",
        "src/cli/main.ts",
        "status",
        "--router-state",
        routerStatePath,
        "--auth-store",
        authStorePath,
        "--json"
      ],
      { cwd: repoRoot }
    );

    const payload = JSON.parse(stdout) as {
      currentOrder: string[];
      nextCandidate?: string;
      authLastGoodProfileId?: string;
      cooldowns: Array<{ alias: string; until?: string }>;
      accounts: Array<{ alias: string; effectiveStatus: string; selected: boolean }>;
    };

    expect(payload.currentOrder).toEqual(["acct-a"]);
    expect(payload.nextCandidate).toBe("acct-a");
    expect(payload.authLastGoodProfileId).toBeUndefined();
    expect(payload.cooldowns).toEqual([]);
    expect(payload.accounts).toHaveLength(1);
    expect(payload.accounts[0]).toMatchObject({
      alias: "acct-a",
      effectiveStatus: "healthy",
      selected: true
    });
  });

  it("auto-loads default integration state from HOME when option is omitted", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "status-default-intg-"));
    cleanupPaths.push(dir);
    const homeDir = path.join(dir, "home");
    const routerStatePath = path.join(dir, "router-state.json");
    const defaultIntegrationStatePath = path.join(homeDir, ".openclaw-router", "integration.json");

    await writeFile(
      routerStatePath,
      JSON.stringify(
        {
          version: 1,
          accounts: []
        },
        null,
        2
      ),
      "utf8"
    );
    await mkdir(path.dirname(defaultIntegrationStatePath), { recursive: true });
    await writeFile(
      defaultIntegrationStatePath,
      JSON.stringify(
        {
          version: 1,
          platform: "linux",
          installRoot: path.join(homeDir, ".openclaw-router"),
          shimPath: path.join(homeDir, ".openclaw-router", "bin", "openclaw"),
          realOpenClawPath: "/usr/bin/openclaw",
          servicePath: path.join(homeDir, ".openclaw-router", "services", "openclaw-router-repair.service"),
          lastSetupAt: "2026-03-19T10:00:00.000Z"
        },
        null,
        2
      ),
      "utf8"
    );

    const { stdout } = await execa(
      "node",
      ["--import", "tsx", "src/cli/main.ts", "status", "--router-state", routerStatePath, "--json"],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          HOME: homeDir
        }
      }
    );

    const payload = JSON.parse(stdout) as {
      integration: {
        installed: boolean;
        integrationStatePath?: string;
      };
    };
    expect(payload.integration.installed).toBe(true);
    expect(payload.integration.integrationStatePath).toBe(defaultIntegrationStatePath);
  });

  it("does not fail when HOME is missing and integration-state is omitted", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "status-no-home-"));
    cleanupPaths.push(dir);
    const routerStatePath = path.join(dir, "router-state.json");
    await writeFile(
      routerStatePath,
      JSON.stringify(
        {
          version: 1,
          accounts: []
        },
        null,
        2
      ),
      "utf8"
    );

    const { stdout } = await execa(
      "node",
      ["--import", "tsx", "src/cli/main.ts", "status", "--router-state", routerStatePath, "--json"],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          HOME: ""
        }
      }
    );

    const payload = JSON.parse(stdout) as { integration: { installed: boolean } };
    expect(payload.integration.installed).toBe(false);
  });

  it("uses router state path from integration state when --router-state is omitted", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "status-intg-router-fallback-"));
    cleanupPaths.push(dir);

    const homeDir = path.join(dir, "home");
    const routerStatePath = path.join(homeDir, ".openclaw-router", "router-state.json");
    const integrationStatePath = path.join(homeDir, ".openclaw-router", "integration.json");
    await mkdir(path.dirname(routerStatePath), { recursive: true });
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
            }
          ]
        },
        null,
        2
      ),
      "utf8"
    );

    await writeFile(
      integrationStatePath,
      JSON.stringify(
        {
          version: 1,
          platform: "linux",
          installRoot: path.join(homeDir, ".openclaw-router"),
          shimPath: path.join(homeDir, ".openclaw-router", "bin", "openclaw"),
          realOpenClawPath: "/usr/bin/openclaw",
          servicePath: path.join(homeDir, ".openclaw-router", "services", "openclaw-router-repair.service"),
          lastSetupAt: "2026-03-19T10:00:00.000Z",
          routerStatePath,
          authStorePath: path.join(homeDir, ".openclaw", "agents", "main", "agent", "auth-profiles.json"),
          authStoreBackupPath: path.join(homeDir, ".openclaw-router", "backups", "auth-profiles.pre-router.json")
        },
        null,
        2
      ),
      "utf8"
    );

    const { stdout } = await execa(
      "node",
      ["--import", "tsx", "src/cli/main.ts", "status", "--integration-state", integrationStatePath, "--json"],
      { cwd: repoRoot }
    );

    const payload = JSON.parse(stdout) as { currentOrder: string[] };
    expect(payload.currentOrder).toEqual(["acct-a"]);
  });
});
