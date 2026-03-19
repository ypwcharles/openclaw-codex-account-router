import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  bindAccount,
  clearAccountCooldown,
  setAccountEnabled
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
      usageStats?: Record<string, { disabledUntil?: number; disabledReason?: string }>;
    };

    expect(router.accounts[0]?.enabled).toBe(true);
    expect(router.accounts[0]?.status).toBe("healthy");
    expect(auth.usageStats?.["openai-codex:user@example.com"]?.disabledUntil).toBeUndefined();
    expect(auth.usageStats?.["openai-codex:user@example.com"]?.disabledReason).toBeUndefined();
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
