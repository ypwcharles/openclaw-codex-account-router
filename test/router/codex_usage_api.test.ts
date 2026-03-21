import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  fetchCodexUsageSnapshot,
  parseCodexUsageResponse
} from "../../src/router/codex_usage_api.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(cleanupPaths.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

describe("codex_usage_api", () => {
  it("times out bounded usage fetches so cooldown routing can fall back", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "codex-usage-auth-"));
    cleanupPaths.push(dir);
    const authStorePath = path.join(dir, "auth-profiles.json");

    await writeFile(
      authStorePath,
      JSON.stringify(
        {
          version: 1,
          profiles: {
            "openai-codex:a@example.com": {
              provider: "openai-codex",
              access: "token-a"
            }
          }
        },
        null,
        2
      ),
      "utf8"
    );

    await expect(
      fetchCodexUsageSnapshot({
        authStorePath,
        profileId: "openai-codex:a@example.com",
        timeoutMs: 10,
        fetchImpl: async () => await new Promise<never>(() => {})
      })
    ).rejects.toThrow("codex usage api timed out after 10ms");
  });

  it("parses quota windows and derives reset times", () => {
    const snapshot = parseCodexUsageResponse(
      JSON.stringify({
        plan_type: "team",
        rate_limit: {
          limit_reached: true,
          primary_window: {
            used_percent: 100,
            limit_window_seconds: 18_000,
            reset_at: 1_763_666_400
          },
          secondary_window: {
            used_percent: 42,
            limit_window_seconds: 604_800,
            reset_after_seconds: 86_400
          }
        }
      }),
      { now: new Date("2026-03-21T10:00:00.000Z") }
    );

    expect(snapshot).toEqual({
      source: "usage_api",
      fetchedAt: Date.parse("2026-03-21T10:00:00.000Z"),
      planType: "team",
      limitReached: true,
      primary: {
        usedPercent: 100,
        remainingPercent: 0,
        windowMinutes: 300,
        resetAt: 1_763_666_400_000
      },
      secondary: {
        usedPercent: 42,
        remainingPercent: 58,
        windowMinutes: 10_080,
        resetAt: Date.parse("2026-03-22T10:00:00.000Z")
      },
      cooldownUntil: 1_763_666_400_000
    });
    expect(snapshot.cooldownUntil).toBe(1_763_666_400_000);
  });

  it("does not round near-limit usage into an exhausted window", () => {
    const snapshot = parseCodexUsageResponse(
      JSON.stringify({
        plan_type: "team",
        rate_limit: {
          primary_window: {
            used_percent: 99.6,
            limit_window_seconds: 18_000,
            reset_at: 1_763_736_000
          }
        }
      }),
      { now: new Date("2026-03-21T10:00:00.000Z") }
    );

    expect(snapshot.primary?.usedPercent).toBe(99.6);
    expect(snapshot.primary?.remainingPercent ?? 0).toBeCloseTo(0.4, 6);
    expect(snapshot.cooldownUntil).toBeUndefined();
  });

  it("uses the latest reset when multiple exhausted quota windows block the account", () => {
    const snapshot = parseCodexUsageResponse(
      JSON.stringify({
        plan_type: "team",
        rate_limit: {
          limit_reached: true,
          primary_window: {
            used_percent: 100,
            limit_window_seconds: 18_000,
            reset_at: 1_763_736_000
          },
          secondary_window: {
            used_percent: 100,
            limit_window_seconds: 604_800,
            reset_at: 1_764_156_400
          }
        }
      }),
      { now: new Date("2026-03-21T10:00:00.000Z") }
    );

    expect(snapshot.primary?.remainingPercent).toBe(0);
    expect(snapshot.secondary?.remainingPercent).toBe(0);
    expect(snapshot.cooldownUntil).toBe(1_764_156_400_000);
  });
});
