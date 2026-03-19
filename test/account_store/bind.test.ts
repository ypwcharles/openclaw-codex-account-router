import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { bindAccount } from "../../src/account_store/bind.js";

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
});
