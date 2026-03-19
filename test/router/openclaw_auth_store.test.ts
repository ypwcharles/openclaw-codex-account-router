import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearProfileCooldown,
  clearProfileFailureState,
  mirrorFailureToOpenClaw,
  syncCodexOrder
} from "../../src/router/openclaw_auth_store.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(cleanupPaths.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

describe("openclaw auth bridge", () => {
  it("writes explicit order and disabled state into auth-profiles.json", async () => {
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
          usageStats: {}
        },
        null,
        2
      ),
      "utf8"
    );

    await syncCodexOrder(authPath, ["openai-codex:b@example.com", "openai-codex:a@example.com"]);
    await mirrorFailureToOpenClaw(authPath, {
      profileId: "openai-codex:a@example.com",
      reason: "auth_permanent",
      now: new Date("2026-03-19T12:00:00.000Z")
    });

    const next = JSON.parse(await readFile(authPath, "utf8")) as {
      order: Record<string, string[]>;
      usageStats: Record<
        string,
        {
          disabledReason?: string;
          disabledUntil?: number;
        }
      >;
    };

    expect(next.order["openai-codex"]?.[0]).toBe("openai-codex:b@example.com");
    expect(next.usageStats["openai-codex:a@example.com"]?.disabledReason).toBe("auth_permanent");
    expect(typeof next.usageStats["openai-codex:a@example.com"]?.disabledUntil).toBe("number");
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
});
