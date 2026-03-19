import { mkdtemp, mkdir, readFile, writeFile, chmod } from "node:fs/promises";
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

describe("setup cli", () => {
  it(
    "prints repair/undo/platform guidance and auto-updates shell PATH profile",
    async () => {
      const fixture = await createSetupFixture("setup-cli-guidance-");
      const { homeDir, authStorePath, realBinDir } = fixture;

      const commandArgs = [
        "--import",
        "tsx",
        "src/cli/main.ts",
        "setup",
        "--home-dir",
        homeDir,
        "--platform",
        "linux",
        "--auth-store",
        authStorePath
      ];

      const env = {
        ...process.env,
        HOME: homeDir,
        SHELL: "/bin/zsh",
        PATH: `${realBinDir}${path.delimiter}${process.env.PATH ?? ""}`
      };

      const first = await execa("node", commandArgs, { cwd: repoRoot, env });

      const integrationStatePath = path.join(homeDir, ".openclaw-router", "integration.json");
      expect(first.stdout).toContain(
        `Repair: openclaw-router repair --integration-state ${integrationStatePath}`
      );
      expect(first.stdout).toContain(
        `Undo: openclaw-router restore --integration-state ${integrationStatePath} --auth-store ${authStorePath}`
      );
      expect(first.stdout).toContain("Inspect service: systemctl --user status openclaw-router-repair.service");

      const profilePath = path.join(homeDir, ".zprofile");
      const profileAfterFirstSetup = await readFile(profilePath, "utf8");
      expect(profileAfterFirstSetup).toContain("# >>> openclaw-router managed path >>>");
      expect(profileAfterFirstSetup).toContain(
        `export PATH=\"${path.join(homeDir, ".openclaw-router", "bin")}:$PATH\"`
      );

      await execa("node", commandArgs, { cwd: repoRoot, env });
      const profileAfterSecondSetup = await readFile(profilePath, "utf8");
      expect((profileAfterSecondSetup.match(/# >>> openclaw-router managed path >>>/gu) ?? []).length).toBe(1);
    },
    15000
  );

  it(
    "prints launchctl inspection guidance on darwin setup",
    async () => {
      const fixture = await createSetupFixture("setup-cli-darwin-");
      const { homeDir, authStorePath, realBinDir } = fixture;

      const { stdout } = await execa(
        "node",
        [
          "--import",
          "tsx",
          "src/cli/main.ts",
          "setup",
          "--home-dir",
          homeDir,
          "--platform",
          "darwin",
          "--auth-store",
          authStorePath
        ],
        {
          cwd: repoRoot,
          env: {
            ...process.env,
            HOME: homeDir,
            SHELL: "/bin/zsh",
            PATH: `${realBinDir}${path.delimiter}${process.env.PATH ?? ""}`
          }
        }
      );

      expect(stdout).toContain("Inspect service: launchctl print gui/$(id -u)/dev.openclaw-router.repair");
    },
    15000
  );
});

async function createSetupFixture(prefix: string): Promise<{
  homeDir: string;
  authStorePath: string;
  realBinDir: string;
}> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  cleanupPaths.push(dir);

  const homeDir = path.join(dir, "home");
  const authStorePath = path.join(homeDir, ".openclaw", "agents", "main", "agent", "auth-profiles.json");
  const realBinDir = path.join(dir, "real-bin");
  const realOpenClawPath = path.join(realBinDir, "openclaw");

  await mkdir(path.dirname(authStorePath), { recursive: true });
  await writeFile(
    authStorePath,
    JSON.stringify(
      {
        version: 1,
        profiles: {
          "openai-codex:a@example.com": {
            provider: "openai-codex",
            access: "a"
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

  await mkdir(realBinDir, { recursive: true });
  await writeFile(realOpenClawPath, "#!/usr/bin/env bash\nexit 0\n", "utf8");
  await chmod(realOpenClawPath, 0o755);

  return {
    homeDir,
    authStorePath,
    realBinDir
  };
}
