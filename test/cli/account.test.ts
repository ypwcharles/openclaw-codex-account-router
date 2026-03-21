import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
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

describe("account cli", () => {
  it("shows account commands in help", async () => {
    const { stdout } = await execa("node", ["--import", "tsx", "src/cli/main.ts", "account", "--help"]);
    expect(stdout).toContain("add");
    expect(stdout).toContain("list");
    expect(stdout).toContain("enable");
    expect(stdout).toContain("disable");
    expect(stdout).toContain("order");
  });

  it("add command writes account into router state", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "account-cli-"));
    cleanupPaths.push(dir);
    const authStorePath = path.join(dir, "auth-profiles.json");
    const routerStatePath = path.join(dir, "router-state.json");

    await mkdir(path.dirname(authStorePath), { recursive: true });
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
        "account",
        "add",
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
        "account",
        "list",
        "--router-state",
        routerStatePath
      ],
      { cwd: repoRoot }
    );

    expect(stdout).toContain("acct-a");
    expect(stdout).toContain("openai-codex:user@example.com");
  });

  it("list command falls back to the installed router-state under HOME", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "account-cli-default-router-state-"));
    cleanupPaths.push(dir);

    const homeDir = path.join(dir, "home");
    const routerStatePath = path.join(homeDir, ".openclaw-router", "router-state.json");
    await mkdir(path.dirname(routerStatePath), { recursive: true });
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

    const { stdout } = await execa("node", ["--import", "tsx", "src/cli/main.ts", "account", "list"], {
      cwd: repoRoot,
      env: {
        ...process.env,
        HOME: homeDir
      }
    });

    expect(stdout).toContain("acct-a");
    expect(stdout).toContain("openai-codex:user@example.com");
  });

  it("add command uses router-state and auth-store from integration state when flags are omitted", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "account-cli-intg-paths-"));
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
          authStorePath,
          authStoreBackupPath: path.join(homeDir, ".openclaw-router", "backups", "auth-profiles.pre-router.json")
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
        "account",
        "add",
        "--profile-id",
        "openai-codex:user@example.com",
        "--alias",
        "acct-z",
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
      ["--import", "tsx", "src/cli/main.ts", "account", "list", "--integration-state", integrationStatePath],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          HOME: homeDir
        }
      }
    );

    expect(stdout).toContain("acct-z");
    expect(stdout).toContain("openai-codex:user@example.com");
  });
});
