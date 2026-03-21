import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  bindAccount,
  clearAccountCooldown,
  setAccountEnabled,
  setAccountOrderByAlias
} from "../../src/account_store/bind.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(cleanupPaths.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

describe("bind account", () => {
  it("binds alias to a concrete openai-codex profile id", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "bind-account-"));
    cleanupPaths.push(dir);
    const routerStatePath = path.join(dir, "router-state.json");
    const authStorePath = path.join(dir, "auth-profiles.json");

    await writeFile(
      authStorePath,
      JSON.stringify(
        {
          version: 1,
          profiles: {
            "openai-codex:user@example.com": {
              type: "oauth",
              provider: "openai-codex",
              access: "token-a",
              refresh: "refresh-a"
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

    const result = await bindAccount({
      alias: "acct-a",
      profileId: "openai-codex:user@example.com",
      routerStatePath,
      authStorePath
    });

    expect(result.account.alias).toBe("acct-a");
    expect(result.account.profileId).toBe("openai-codex:user@example.com");

    const authStore = JSON.parse(await readFile(authStorePath, "utf8")) as {
      order?: Record<string, string[]>;
    };
    expect(authStore.order?.["openai-codex"]?.[0]).toBe("openai-codex:user@example.com");
  });

  it("hydrates a newly bound account to healthy when quota snapshot is available", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "bind-account-hydrate-healthy-"));
    cleanupPaths.push(dir);
    const routerStatePath = path.join(dir, "router-state.json");
    const authStorePath = path.join(dir, "auth-profiles.json");

    await writeFile(
      authStorePath,
      JSON.stringify(
        {
          version: 1,
          profiles: {
            "openai-codex:user@example.com": {
              type: "oauth",
              provider: "openai-codex",
              access: "token-a",
              refresh: "refresh-a"
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

    const result = await bindAccount(
      {
        alias: "acct-a",
        profileId: "openai-codex:user@example.com",
        routerStatePath,
        authStorePath
      },
      {
        fetchCodexUsage: async () => ({
          source: "usage_api",
          fetchedAt: Date.parse("2026-03-21T12:00:00.000Z"),
          planType: "team",
          limitReached: false,
          primary: {
            usedPercent: 12.5,
            remainingPercent: 87.5,
            windowMinutes: 300,
            resetAt: Date.parse("2026-03-21T17:00:00.000Z")
          }
        })
      }
    );

    expect(result.account.status).toBe("healthy");
    expect(result.account.cooldownUntil).toBeUndefined();

    const authStore = JSON.parse(await readFile(authStorePath, "utf8")) as {
      usageStats?: Record<
        string,
        {
          quotaSource?: string;
          planType?: string;
          cooldownUntil?: number;
          quota?: {
            limitReached?: boolean;
            primary?: {
              usedPercent?: number;
            };
          };
        }
      >;
    };
    expect(authStore.usageStats?.["openai-codex:user@example.com"]?.quotaSource).toBe("usage_api");
    expect(authStore.usageStats?.["openai-codex:user@example.com"]?.planType).toBe("team");
    expect(authStore.usageStats?.["openai-codex:user@example.com"]?.cooldownUntil).toBeUndefined();
    expect(authStore.usageStats?.["openai-codex:user@example.com"]?.quota?.limitReached).toBe(false);
    expect(authStore.usageStats?.["openai-codex:user@example.com"]?.quota?.primary?.usedPercent).toBe(12.5);
  });

  it("hydrates a newly bound account into cooldown when quota is already exhausted", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "bind-account-hydrate-cooldown-"));
    cleanupPaths.push(dir);
    const routerStatePath = path.join(dir, "router-state.json");
    const authStorePath = path.join(dir, "auth-profiles.json");

    await writeFile(
      authStorePath,
      JSON.stringify(
        {
          version: 1,
          profiles: {
            "openai-codex:user@example.com": {
              type: "oauth",
              provider: "openai-codex",
              access: "token-a",
              refresh: "refresh-a"
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

    const result = await bindAccount(
      {
        alias: "acct-a",
        profileId: "openai-codex:user@example.com",
        routerStatePath,
        authStorePath
      },
      {
        fetchCodexUsage: async () => ({
          source: "usage_api",
          fetchedAt: Date.parse("2026-03-21T12:00:00.000Z"),
          planType: "team",
          limitReached: true,
          primary: {
            usedPercent: 100,
            remainingPercent: 0,
            windowMinutes: 300,
            resetAt: Date.parse("2026-03-21T17:00:00.000Z")
          },
          cooldownUntil: Date.parse("2026-03-21T17:00:00.000Z")
        })
      }
    );

    expect(result.account.status).toBe("cooldown");
    expect(result.account.lastErrorCode).toBe("rate_limit");
    expect(result.account.cooldownUntil).toBe("2026-03-21T17:00:00.000Z");

    const authStore = JSON.parse(await readFile(authStorePath, "utf8")) as {
      order?: Record<string, string[]>;
      usageStats?: Record<string, { cooldownUntil?: number; quota?: { limitReached?: boolean } }>;
    };
    expect(authStore.usageStats?.["openai-codex:user@example.com"]?.cooldownUntil).toBe(
      Date.parse("2026-03-21T17:00:00.000Z")
    );
    expect(authStore.usageStats?.["openai-codex:user@example.com"]?.quota?.limitReached).toBe(true);
    expect(authStore.order?.["openai-codex"] ?? []).not.toContain("openai-codex:user@example.com");
  });

  it("keeps exhausted newly bound profiles out of synced order when other routable accounts exist", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "bind-account-order-after-hydration-"));
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
              access: "token-a",
              refresh: "refresh-a"
            },
            "openai-codex:b@example.com": {
              type: "oauth",
              provider: "openai-codex",
              access: "token-b",
              refresh: "refresh-b"
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

    const result = await bindAccount(
      {
        alias: "acct-a",
        profileId: "openai-codex:a@example.com",
        routerStatePath,
        authStorePath,
        priority: 10
      },
      {
        fetchCodexUsage: async ({ profileId }) =>
          profileId === "openai-codex:a@example.com"
            ? {
                source: "usage_api",
                fetchedAt: Date.parse("2026-03-21T12:00:00.000Z"),
                planType: "team",
                limitReached: true,
                primary: {
                  usedPercent: 100,
                  remainingPercent: 0,
                  windowMinutes: 300,
                  resetAt: Date.parse("2026-03-21T17:00:00.000Z")
                },
                cooldownUntil: Date.parse("2026-03-21T17:00:00.000Z")
              }
            : undefined
      }
    );

    expect(result.account.status).toBe("cooldown");

    const authStore = JSON.parse(await readFile(authStorePath, "utf8")) as {
      order?: Record<string, string[]>;
    };
    expect(authStore.order?.["openai-codex"]).toEqual(["openai-codex:b@example.com"]);
  });

  it("rebinds to a different profile without inheriting stale healthy state", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "bind-account-rebind-profile-change-"));
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
              profileId: "openai-codex:old@example.com",
              provider: "openai-codex",
              priority: 10,
              status: "healthy",
              enabled: true,
              lastSuccessAt: "2026-03-21T08:00:00.000Z"
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
            "openai-codex:old@example.com": {
              type: "oauth",
              provider: "openai-codex",
              access: "token-old",
              refresh: "refresh-old"
            },
            "openai-codex:new@example.com": {
              type: "oauth",
              provider: "openai-codex",
              access: "token-new",
              refresh: "refresh-new"
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

    const result = await bindAccount(
      {
        alias: "acct-a",
        profileId: "openai-codex:new@example.com",
        routerStatePath,
        authStorePath
      },
      {
        fetchCodexUsage: async ({ profileId }) => {
          if (profileId !== "openai-codex:new@example.com") {
            throw new Error(`unexpected profile ${profileId}`);
          }
          return {
            source: "usage_api",
            fetchedAt: Date.parse("2026-03-21T12:00:00.000Z"),
            planType: "team",
            limitReached: true,
            primary: {
              usedPercent: 100,
              remainingPercent: 0,
              windowMinutes: 300,
              resetAt: Date.parse("2026-03-21T17:00:00.000Z")
            },
            cooldownUntil: Date.parse("2026-03-21T17:00:00.000Z")
          };
        }
      }
    );

    expect(result.account.profileId).toBe("openai-codex:new@example.com");
    expect(result.account.status).toBe("cooldown");
    expect(result.account.lastErrorCode).toBe("rate_limit");
    expect(result.account.lastSuccessAt).toBeUndefined();

    const routerState = JSON.parse(await readFile(routerStatePath, "utf8")) as {
      accounts: Array<{
        alias: string;
        profileId: string;
        status: string;
        cooldownUntil?: string;
        lastSuccessAt?: string;
        lastFailureAt?: string;
        lastErrorCode?: string;
      }>;
    };
    const rebound = routerState.accounts.find((account) => account.alias === "acct-a");
    expect(rebound).toMatchObject({
      alias: "acct-a",
      profileId: "openai-codex:new@example.com",
      status: "cooldown",
      cooldownUntil: "2026-03-21T17:00:00.000Z",
      lastErrorCode: "rate_limit"
    });
    expect(rebound?.lastSuccessAt).toBeUndefined();
    expect(rebound?.lastFailureAt).toBeDefined();
  });

  it("does not fail binding when initial quota hydration errors", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "bind-account-hydrate-error-"));
    cleanupPaths.push(dir);
    const routerStatePath = path.join(dir, "router-state.json");
    const authStorePath = path.join(dir, "auth-profiles.json");

    await writeFile(
      authStorePath,
      JSON.stringify(
        {
          version: 1,
          profiles: {
            "openai-codex:user@example.com": {
              type: "oauth",
              provider: "openai-codex",
              access: "token-a",
              refresh: "refresh-a"
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

    const result = await bindAccount(
      {
        alias: "acct-a",
        profileId: "openai-codex:user@example.com",
        routerStatePath,
        authStorePath
      },
      {
        fetchCodexUsage: async () => {
          throw new Error("usage fetch failed");
        }
      }
    );

    expect(result.account.status).toBe("unknown");
    const routerState = JSON.parse(await readFile(routerStatePath, "utf8")) as {
      accounts: Array<{ alias: string; status: string }>;
    };
    expect(routerState.accounts.find((account) => account.alias === "acct-a")?.status).toBe("unknown");
  });

  it("refuses ambiguous default-profile rebinding without force", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "bind-account-"));
    cleanupPaths.push(dir);
    const routerStatePath = path.join(dir, "router-state.json");
    const authStorePath = path.join(dir, "auth-profiles.json");

    await writeFile(
      authStorePath,
      JSON.stringify(
        {
          version: 1,
          profiles: {
            "openai-codex:default": {
              type: "oauth",
              provider: "openai-codex",
              access: "token-default",
              refresh: "refresh-default"
            }
          }
        },
        null,
        2
      ),
      "utf8"
    );

    await expect(
      bindAccount({
        alias: "acct-a",
        profileId: "openai-codex:default",
        routerStatePath,
        authStorePath
      })
    ).rejects.toThrow("ambiguous");
  });

  it("enable clears disabled status and mirrored auth-store disable state", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "bind-account-"));
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
              profileId: "openai-codex:user@example.com",
              provider: "openai-codex",
              priority: 10,
              status: "disabled",
              enabled: false
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
            "openai-codex:user@example.com": {
              type: "oauth",
              provider: "openai-codex",
              access: "token-a",
              refresh: "refresh-a"
            }
          },
          usageStats: {
            "openai-codex:user@example.com": {
              disabledUntil: 9_999_999_999_999,
              disabledReason: "auth_permanent"
            }
          }
        },
        null,
        2
      ),
      "utf8"
    );

    await setAccountEnabled({
      routerStatePath,
      authStorePath,
      alias: "acct-a",
      enabled: true
    });

    const router = JSON.parse(await readFile(routerStatePath, "utf8")) as {
      accounts: Array<{ alias: string; status: string; enabled: boolean }>;
    };
    const auth = JSON.parse(await readFile(authStorePath, "utf8")) as {
      order?: Record<string, string[]>;
      usageStats?: Record<string, { disabledUntil?: number; disabledReason?: string }>;
    };

    expect(router.accounts[0]?.enabled).toBe(true);
    expect(router.accounts[0]?.status).toBe("healthy");
    expect(auth.order?.["openai-codex"]).toEqual(["openai-codex:user@example.com"]);
    expect(auth.usageStats?.["openai-codex:user@example.com"]?.disabledUntil).toBeUndefined();
    expect(auth.usageStats?.["openai-codex:user@example.com"]?.disabledReason).toBeUndefined();
  });

  it("enable does not reintroduce cooldown accounts into synced order", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "bind-account-enable-cooldown-order-"));
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
              status: "cooldown",
              enabled: false,
              cooldownUntil: "2099-01-01T00:00:00.000Z",
              lastErrorCode: "rate_limit"
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
          usageStats: {
            "openai-codex:a@example.com": {
              cooldownUntil: 9_999_999_999_999
            }
          }
        },
        null,
        2
      ),
      "utf8"
    );

    await setAccountEnabled({
      routerStatePath,
      authStorePath,
      alias: "acct-a",
      enabled: true
    });

    const auth = JSON.parse(await readFile(authStorePath, "utf8")) as {
      order?: Record<string, string[]>;
    };
    expect(auth.order?.["openai-codex"]).toEqual(["openai-codex:b@example.com"]);
  });

  it("setAccountOrderByAlias syncs only routable profiles", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "bind-account-order-routable-only-"));
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
              status: "cooldown",
              enabled: true,
              cooldownUntil: "2099-01-01T00:00:00.000Z",
              lastErrorCode: "rate_limit"
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

    await setAccountOrderByAlias({
      routerStatePath,
      authStorePath,
      aliases: ["acct-a", "acct-b"]
    });

    const auth = JSON.parse(await readFile(authStorePath, "utf8")) as {
      order?: Record<string, string[]>;
    };
    expect(auth.order?.["openai-codex"]).toEqual(["openai-codex:b@example.com"]);
  });

  it("cooldown clear only clears cooldown and mirrors state reset", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "bind-account-"));
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
              profileId: "openai-codex:user@example.com",
              provider: "openai-codex",
              priority: 10,
              status: "cooldown",
              enabled: true,
              cooldownUntil: "2099-01-01T00:00:00.000Z",
              lastErrorCode: "rate_limit"
            },
            {
              alias: "acct-b",
              profileId: "openai-codex:user2@example.com",
              provider: "openai-codex",
              priority: 20,
              status: "disabled",
              enabled: true,
              lastErrorCode: "auth_revoked"
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
            "openai-codex:user@example.com": { type: "oauth", provider: "openai-codex", access: "a" },
            "openai-codex:user2@example.com": { type: "oauth", provider: "openai-codex", access: "b" }
          },
          usageStats: {
            "openai-codex:user@example.com": {
              cooldownUntil: 9_999_999_999_999
            }
          }
        },
        null,
        2
      ),
      "utf8"
    );

    await clearAccountCooldown({
      routerStatePath,
      authStorePath,
      alias: "acct-a"
    });

    const router = JSON.parse(await readFile(routerStatePath, "utf8")) as {
      accounts: Array<{ alias: string; status: string; lastErrorCode?: string; cooldownUntil?: string }>;
    };
    const auth = JSON.parse(await readFile(authStorePath, "utf8")) as {
      order?: Record<string, string[]>;
      usageStats?: Record<
        string,
        { cooldownUntil?: number; disabledUntil?: number; disabledReason?: string }
      >;
    };

    const acctA = router.accounts.find((account) => account.alias === "acct-a");
    const acctB = router.accounts.find((account) => account.alias === "acct-b");
    expect(acctA?.status).toBe("healthy");
    expect(acctA?.lastErrorCode).toBeUndefined();
    expect(acctA?.cooldownUntil).toBeUndefined();
    expect(acctB?.status).toBe("disabled");
    expect(auth.order?.["openai-codex"]).toEqual(["openai-codex:user@example.com"]);
    expect(auth.usageStats?.["openai-codex:user@example.com"]?.cooldownUntil).toBeUndefined();
    expect(auth.usageStats?.["openai-codex:user2@example.com"]?.disabledUntil).toBeUndefined();
    expect(auth.usageStats?.["openai-codex:user2@example.com"]?.disabledReason).toBeUndefined();
  });

  it("cooldown clear does not clear mirrored disabled markers", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "bind-account-"));
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
              profileId: "openai-codex:user@example.com",
              provider: "openai-codex",
              priority: 10,
              status: "disabled",
              enabled: true,
              lastErrorCode: "auth_revoked"
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
            "openai-codex:user@example.com": { type: "oauth", provider: "openai-codex", access: "a" }
          },
          usageStats: {
            "openai-codex:user@example.com": {
              disabledUntil: 8_888_888_888_888,
              disabledReason: "auth_permanent"
            }
          }
        },
        null,
        2
      ),
      "utf8"
    );

    await clearAccountCooldown({
      routerStatePath,
      authStorePath,
      alias: "acct-a"
    });

    const auth = JSON.parse(await readFile(authStorePath, "utf8")) as {
      usageStats?: Record<string, { disabledUntil?: number; disabledReason?: string }>;
    };
    expect(auth.usageStats?.["openai-codex:user@example.com"]?.disabledUntil).toBe(8_888_888_888_888);
    expect(auth.usageStats?.["openai-codex:user@example.com"]?.disabledReason).toBe("auth_permanent");
  });
});
