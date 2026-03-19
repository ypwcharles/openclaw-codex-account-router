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

describe("accounts cli", () => {
  it("shows accounts commands in help", async () => {
    const { stdout } = await execa("node", ["--import", "tsx", "src/cli/main.ts", "accounts", "--help"]);
    expect(stdout).toContain("bind");
    expect(stdout).toContain("list");
    expect(stdout).toContain("enable");
    expect(stdout).toContain("disable");
    expect(stdout).toContain("order");
  });

  it("bind command writes account into router state", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "accounts-cli-"));
    cleanupPaths.push(dir);
    const authStorePath = path.join(dir, "auth-profiles.json");
    const routerStatePath = path.join(dir, "router-state.json");

    await writeFile(
      authStorePath,
      JSON.stringify(
        {
          version: 1,
          profiles: {
            "openai-codex:user@example.com": {
              type: "oauth",
              provider: "openai-codex",
              access: "token"
            }
          }
        },
        null,
        2
      ),
      "utf8"
    );

    await execa(
      "node",
      [
        "--import",
        "tsx",
        "src/cli/main.ts",
        "accounts",
        "bind",
        "--alias",
        "acct-a",
        "--profile-id",
        "openai-codex:user@example.com",
        "--router-state",
        routerStatePath,
        "--auth-store",
        authStorePath
      ],
      { cwd: repoRoot }
    );

    const { stdout } = await execa(
      "node",
      [
        "--import",
        "tsx",
        "src/cli/main.ts",
        "accounts",
        "list",
        "--router-state",
        routerStatePath
      ],
      { cwd: repoRoot }
    );

    expect(stdout).toContain("acct-a");
    expect(stdout).toContain("openai-codex:user@example.com");
  });
});
