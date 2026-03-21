import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
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

  it("compat accounts commands use integration-state paths when explicit flags are omitted", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "accounts-cli-intg-paths-"));
    cleanupPaths.push(dir);

    const homeDir = path.join(dir, "home");
    const customRoot = path.join(dir, "custom-state");
    const authStorePath = path.join(customRoot, "auth-profiles.json");
    const routerStatePath = path.join(customRoot, "router-state.json");
    const integrationStatePath = path.join(homeDir, ".openclaw-router", "integration.json");

    await mkdir(path.dirname(authStorePath), { recursive: true });
    await mkdir(path.dirname(integrationStatePath), { recursive: true });
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
    await writeFile(
      integrationStatePath,
      JSON.stringify(
        {
          version: 1,
          platform: "linux",
          installRoot: path.join(homeDir, ".openclaw-router"),
          shimPath: path.join(homeDir, ".openclaw-router", "bin", "openclaw"),
          realOpenClawPath: "/usr/bin/openclaw",
          servicePath: path.join(homeDir, ".openclaw-router", "services", "openclaw-router-repair.service"),
          lastSetupAt: "2026-03-21T00:00:00.000Z",
          routerStatePath,
          authStorePath
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
        "acct-b",
        "--profile-id",
        "openai-codex:user@example.com",
        "--integration-state",
        integrationStatePath
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          HOME: homeDir
        }
      }
    );

    const { stdout } = await execa(
      "node",
      ["--import", "tsx", "src/cli/main.ts", "accounts", "list", "--integration-state", integrationStatePath],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          HOME: homeDir
        }
      }
    );

    expect(stdout).toContain("acct-b");
    expect(stdout).toContain("openai-codex:user@example.com");
  });
});
