import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearProfileCooldown,
  clearProfileFailureState,
  mirrorFailureToOpenClaw,
  mirrorSuccessToOpenClaw,
  syncAutoSessionAuthOverrides,
  syncCodexOrder
} from "../../src/router/openclaw_auth_store.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(cleanupPaths.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

describe("openclaw auth bridge", () => {
  it("writes explicit order without overwriting lastGood", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "openclaw-auth-"));
    cleanupPaths.push(dir);
    const authPath = path.join(dir, "auth-profiles.json");

    await writeFile(
      authPath,
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
          order: {
            "openai-codex": ["openai-codex:a@example.com", "openai-codex:b@example.com"]
          },
          lastGood: {
            "openai-codex": "openai-codex:a@example.com"
          },
          usageStats: {}
        },
        null,
        2
      ),
      "utf8"
    );

    await syncCodexOrder(authPath, ["openai-codex:b@example.com", "openai-codex:a@example.com"]);

    const next = JSON.parse(await readFile(authPath, "utf8")) as {
      order: Record<string, string[]>;
      lastGood?: Record<string, string>;
    };

    expect(next.order["openai-codex"]?.[0]).toBe("openai-codex:b@example.com");
    expect(next.lastGood?.["openai-codex"]).toBe("openai-codex:a@example.com");
  });

  it("writes disabled state into auth-profiles.json", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "openclaw-auth-"));
    cleanupPaths.push(dir);
    const authPath = path.join(dir, "auth-profiles.json");

    await writeFile(
      authPath,
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
          order: {
            "openai-codex": ["openai-codex:b@example.com", "openai-codex:a@example.com"]
          },
          lastGood: {
            "openai-codex": "openai-codex:b@example.com"
          },
          usageStats: {}
        },
        null,
        2
      ),
      "utf8"
    );

    await mirrorFailureToOpenClaw(authPath, {
      profileId: "openai-codex:a@example.com",
      reason: "auth_permanent",
      now: new Date("2026-03-19T12:00:00.000Z")
    });

    const next = JSON.parse(await readFile(authPath, "utf8")) as {
      lastGood?: Record<string, string>;
      usageStats: Record<
        string,
        {
          disabledReason?: string;
          disabledUntil?: number;
        }
      >;
    };

    expect(next.lastGood?.["openai-codex"]).toBe("openai-codex:b@example.com");
    expect(next.usageStats["openai-codex:a@example.com"]?.disabledReason).toBe("auth_permanent");
    expect(typeof next.usageStats["openai-codex:a@example.com"]?.disabledUntil).toBe("number");
  });

  it("mirrors successful codex usage into lastGood and lastUsed", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "openclaw-auth-"));
    cleanupPaths.push(dir);
    const authPath = path.join(dir, "auth-profiles.json");

    await writeFile(
      authPath,
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
          order: {
            "openai-codex": ["openai-codex:b@example.com", "openai-codex:a@example.com"]
          },
          lastGood: {
            "openai-codex": "openai-codex:a@example.com"
          },
          usageStats: {
            "openai-codex:b@example.com": {
              cooldownUntil: 9_999_999_999_999,
              disabledUntil: 8_888_888_888_888,
              disabledReason: "billing",
              errorCount: 4
            }
          }
        },
        null,
        2
      ),
      "utf8"
    );

    await mirrorSuccessToOpenClaw(authPath, {
      profileId: "openai-codex:b@example.com",
      now: new Date("2026-03-21T09:31:39.679Z")
    });

    const next = JSON.parse(await readFile(authPath, "utf8")) as {
      lastGood?: Record<string, string>;
      usageStats?: Record<
        string,
        {
          lastUsed?: number;
          cooldownUntil?: number;
          disabledUntil?: number;
          disabledReason?: string;
          errorCount?: number;
        }
      >;
    };

    expect(next.lastGood?.["openai-codex"]).toBe("openai-codex:b@example.com");
    expect(next.usageStats?.["openai-codex:b@example.com"]?.lastUsed).toBe(
      Date.parse("2026-03-21T09:31:39.679Z")
    );
    expect(next.usageStats?.["openai-codex:b@example.com"]?.cooldownUntil).toBeUndefined();
    expect(next.usageStats?.["openai-codex:b@example.com"]?.disabledUntil).toBeUndefined();
    expect(next.usageStats?.["openai-codex:b@example.com"]?.disabledReason).toBeUndefined();
    expect(next.usageStats?.["openai-codex:b@example.com"]?.errorCount).toBe(0);
  });

  it("clears mirrored cooldown and disable markers for a profile", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "openclaw-auth-"));
    cleanupPaths.push(dir);
    const authPath = path.join(dir, "auth-profiles.json");

    await writeFile(
      authPath,
      JSON.stringify(
        {
          version: 1,
          profiles: {
            "openai-codex:a@example.com": {
              type: "oauth",
              provider: "openai-codex",
              access: "a"
            }
          },
          usageStats: {
            "openai-codex:a@example.com": {
              cooldownUntil: 9_999_999_999_999,
              disabledUntil: 9_999_999_999_999,
              disabledReason: "billing"
            }
          }
        },
        null,
        2
      ),
      "utf8"
    );

    await clearProfileFailureState(authPath, "openai-codex:a@example.com");

    const next = JSON.parse(await readFile(authPath, "utf8")) as {
      usageStats: Record<
        string,
        {
          cooldownUntil?: number;
          disabledUntil?: number;
          disabledReason?: string;
        }
      >;
    };
    expect(next.usageStats["openai-codex:a@example.com"]?.cooldownUntil).toBeUndefined();
    expect(next.usageStats["openai-codex:a@example.com"]?.disabledUntil).toBeUndefined();
    expect(next.usageStats["openai-codex:a@example.com"]?.disabledReason).toBeUndefined();
  });

  it("clears only cooldown marker without touching disable marker", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "openclaw-auth-"));
    cleanupPaths.push(dir);
    const authPath = path.join(dir, "auth-profiles.json");

    await writeFile(
      authPath,
      JSON.stringify(
        {
          version: 1,
          profiles: {
            "openai-codex:a@example.com": {
              type: "oauth",
              provider: "openai-codex",
              access: "a"
            }
          },
          usageStats: {
            "openai-codex:a@example.com": {
              cooldownUntil: 9_999_999_999_999,
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

    await clearProfileCooldown(authPath, "openai-codex:a@example.com");

    const next = JSON.parse(await readFile(authPath, "utf8")) as {
      usageStats: Record<
        string,
        {
          cooldownUntil?: number;
          disabledUntil?: number;
          disabledReason?: string;
        }
      >;
    };
    expect(next.usageStats["openai-codex:a@example.com"]?.cooldownUntil).toBeUndefined();
    expect(next.usageStats["openai-codex:a@example.com"]?.disabledUntil).toBe(8_888_888_888_888);
    expect(next.usageStats["openai-codex:a@example.com"]?.disabledReason).toBe("auth_permanent");
  });

  it("syncs auto codex session overrides to the first ordered profile", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "openclaw-sessions-"));
    cleanupPaths.push(dir);
    const sessionStorePath = path.join(dir, "sessions.json");

    await writeFile(
      sessionStorePath,
      JSON.stringify(
        {
          "agent:main:telegram:direct:1": {
            modelProvider: "openai-codex",
            compactionCount: 2,
            authProfileOverride: "openai-codex:default",
            authProfileOverrideSource: "auto",
            authProfileOverrideCompactionCount: 0
          },
          "agent:main:telegram:direct:2": {
            modelProvider: "openai-codex",
            compactionCount: 1,
            authProfileOverride: "openai-codex:locked@example.com",
            authProfileOverrideSource: "user",
            authProfileOverrideCompactionCount: 1
          },
          "agent:main:discord:direct:3": {
            modelProvider: "anthropic",
            authProfileOverride: "anthropic:default",
            authProfileOverrideSource: "auto"
          }
        },
        null,
        2
      ),
      "utf8"
    );

    await syncAutoSessionAuthOverrides(sessionStorePath, ["openai-codex:raj@example.com"]);

    const next = JSON.parse(await readFile(sessionStorePath, "utf8")) as Record<
      string,
      {
        authProfileOverride?: string;
        authProfileOverrideSource?: string;
        authProfileOverrideCompactionCount?: number;
      }
    >;

    expect(next["agent:main:telegram:direct:1"]?.authProfileOverride).toBe(
      "openai-codex:raj@example.com"
    );
    expect(next["agent:main:telegram:direct:1"]?.authProfileOverrideSource).toBe("auto");
    expect(next["agent:main:telegram:direct:1"]?.authProfileOverrideCompactionCount).toBe(2);
    expect(next["agent:main:telegram:direct:2"]?.authProfileOverride).toBe(
      "openai-codex:locked@example.com"
    );
    expect(next["agent:main:discord:direct:3"]?.authProfileOverride).toBe("anthropic:default");
  });
});
