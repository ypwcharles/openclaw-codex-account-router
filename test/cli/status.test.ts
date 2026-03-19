import { mkdtemp, writeFile } from "node:fs/promises";
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
  it("shows current pool and next candidate", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "status-cli-"));
    cleanupPaths.push(dir);
    const routerStatePath = path.join(dir, "router-state.json");
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

    const { stdout } = await execa(
      "node",
      [
        "--import",
        "tsx",
        "src/cli/main.ts",
        "status",
        "--router-state",
        routerStatePath,
        "--json"
      ],
      { cwd: repoRoot }
    );

    const payload = JSON.parse(stdout) as {
      currentOrder: string[];
      nextCandidate?: string;
      lastProviderFallbackReason?: string;
      cooldowns: Array<{ alias: string; until?: string }>;
    };
    expect(payload.currentOrder).toEqual(["acct-a", "acct-b", "acct-c"]);
    expect(payload.cooldowns).toEqual([
      { alias: "acct-c", until: "2099-01-01T00:00:00.000Z" }
    ]);
    expect(payload.nextCandidate).toBe("acct-a");
    expect(payload.lastProviderFallbackReason).toBe("Codex account pool exhausted");
  });
});
