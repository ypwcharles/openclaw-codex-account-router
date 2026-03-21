import { describe, expect, it } from "vitest";
import { parseCodexUsageResponse } from "../../src/router/codex_usage_api.js";

describe("codex_usage_api", () => {
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
});
