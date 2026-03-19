import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runDoctor } from "../../src/cli/commands/doctor.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(cleanupPaths.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

describe("doctor command", () => {
  it(
    "returns failed checks instead of throwing when auth store json is invalid",
    async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "doctor-cli-"));
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
      await writeFile(authStorePath, "{invalid json", "utf8");

      const result = await runDoctor({
        routerStatePath,
        authStorePath
      });
      const mapping = result.checks.find((check) => check.id === "alias_profile_mapping");

      expect(mapping?.ok).toBe(false);
      expect(mapping?.detail).toContain("cannot read/parse auth store");
    },
    15000
  );
});
