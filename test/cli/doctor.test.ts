import { chmod, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { execa } from "execa";
import { fileURLToPath } from "node:url";
import { runDoctor } from "../../src/cli/commands/doctor.js";

const cleanupPaths: string[] = [];
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

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

  it("validates integration artifacts from integration state", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "doctor-intg-"));
    cleanupPaths.push(dir);
    const routerStatePath = path.join(dir, "router-state.json");
    const authStorePath = path.join(dir, "auth-profiles.json");
    const integrationStatePath = path.join(dir, "integration.json");
    const shimPath = path.join(dir, "bin", "openclaw");
    const servicePath = path.join(dir, "services", "openclaw-router-repair.service");

    await writeFile(
      routerStatePath,
      JSON.stringify({ version: 1, accounts: [] }, null, 2),
      "utf8"
    );
    await writeFile(
      authStorePath,
      JSON.stringify({ version: 1, profiles: {} }, null, 2),
      "utf8"
    );
    await writeFile(
      integrationStatePath,
      JSON.stringify(
        {
          version: 1,
          platform: "linux",
          installRoot: dir,
          shimPath,
          realOpenClawPath: "/usr/bin/openclaw",
          servicePath,
          lastSetupAt: "2026-03-19T10:00:00.000Z"
        },
        null,
        2
      ),
      "utf8"
    );

    await mkdir(path.dirname(shimPath), { recursive: true });
    await writeFile(shimPath, "#!/usr/bin/env bash\n", "utf8");

    const result = await runDoctor({
      routerStatePath,
      authStorePath,
      integrationStatePath
    });

    const integrationReadable = result.checks.find((check) => check.id === "integration_state_readable");
    const shimExists = result.checks.find((check) => check.id === "integration_shim_exists");
    const serviceExists = result.checks.find((check) => check.id === "integration_service_exists");

    expect(integrationReadable?.ok).toBe(true);
    expect(shimExists?.ok).toBe(true);
    expect(serviceExists?.ok).toBe(false);
  });

  it(
    "auto-loads integration checks from default HOME path",
    async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "doctor-default-intg-"));
      cleanupPaths.push(dir);

    const homeDir = path.join(dir, "home");
    const routerStatePath = path.join(dir, "router-state.json");
    const authStorePath = path.join(dir, "auth-profiles.json");
    const integrationStatePath = path.join(homeDir, ".openclaw-router", "integration.json");
    const shimPath = path.join(homeDir, ".openclaw-router", "bin", "openclaw");
    const servicePath = path.join(homeDir, ".openclaw-router", "services", "openclaw-router-repair.service");

    await writeFile(routerStatePath, JSON.stringify({ version: 1, accounts: [] }, null, 2), "utf8");
    await writeFile(authStorePath, JSON.stringify({ version: 1, profiles: {} }, null, 2), "utf8");
    await mkdir(path.dirname(integrationStatePath), { recursive: true });
    await writeFile(
      integrationStatePath,
      JSON.stringify(
        {
          version: 1,
          platform: "linux",
          installRoot: path.join(homeDir, ".openclaw-router"),
          shimPath,
          realOpenClawPath: "/usr/bin/openclaw",
          servicePath,
          lastSetupAt: "2026-03-19T10:00:00.000Z"
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
        "doctor",
        "--router-state",
        routerStatePath,
        "--auth-store",
        authStorePath,
        "--json"
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          HOME: homeDir
        }
      }
    );

      const payload = JSON.parse(stdout) as { checks: Array<{ id: string }> };
      expect(payload.checks.some((check) => check.id === "integration_state_readable")).toBe(true);
    },
    15000
  );

  it(
    "auto-discovers router and auth paths from integration state when flags are omitted",
    async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "doctor-default-paths-"));
      cleanupPaths.push(dir);

      const homeDir = path.join(dir, "home");
      const routerStatePath = path.join(dir, "custom-router-state.json");
      const authStorePath = path.join(dir, "custom-auth-profiles.json");
      const integrationStatePath = path.join(homeDir, ".openclaw-router", "integration.json");
      const shimPath = path.join(homeDir, ".openclaw-router", "bin", "openclaw");
      const servicePath = path.join(homeDir, ".openclaw-router", "services", "openclaw-router-repair.service");

      await writeFile(routerStatePath, JSON.stringify({ version: 1, accounts: [] }, null, 2), "utf8");
      await writeFile(
        authStorePath,
        JSON.stringify({ version: 1, profiles: {}, order: {}, usageStats: {} }, null, 2),
        "utf8"
      );
      await mkdir(path.dirname(integrationStatePath), { recursive: true });
      await writeFile(
        integrationStatePath,
        JSON.stringify(
          {
            version: 1,
            platform: "linux",
            installRoot: path.join(homeDir, ".openclaw-router"),
            shimPath,
            realOpenClawPath: "/usr/bin/openclaw",
            servicePath,
            lastSetupAt: "2026-03-19T10:00:00.000Z",
            routerStatePath,
            authStorePath
          },
          null,
          2
        ),
        "utf8"
      );

      const { stdout } = await execa(
        "node",
        ["--import", "tsx", "src/cli/main.ts", "doctor", "--json"],
        {
          cwd: repoRoot,
          env: {
            ...process.env,
            HOME: homeDir
          }
        }
      );

      const payload = JSON.parse(stdout) as { checks: Array<{ id: string; detail: string }> };
      const authStoreAccess = payload.checks.find((check) => check.id === "auth_store_access");
      const integrationReadable = payload.checks.find((check) => check.id === "integration_state_readable");

      expect(authStoreAccess?.detail).toBe(authStorePath);
      expect(integrationReadable?.detail).toBe(integrationStatePath);
    },
    15000
  );

  it("marks openclaw_binary healthy when openclaw is executable even if help is slow", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "doctor-openclaw-exit-"));
    cleanupPaths.push(dir);

    const fakeBinDir = path.join(dir, "bin");
    const fakeOpenClawPath = path.join(fakeBinDir, "openclaw");
    const routerStatePath = path.join(dir, "router-state.json");
    const authStorePath = path.join(dir, "auth-profiles.json");
    const integrationStatePath = path.join(dir, "integration.json");

    await mkdir(fakeBinDir, { recursive: true });
    await writeFile(fakeOpenClawPath, "#!/usr/bin/env bash\nsleep 10\n", "utf8");
    await chmod(fakeOpenClawPath, 0o755);

    await writeFile(routerStatePath, JSON.stringify({ version: 1, accounts: [] }, null, 2), "utf8");
    await writeFile(authStorePath, JSON.stringify({ version: 1, profiles: {} }, null, 2), "utf8");
    await writeFile(
      integrationStatePath,
      JSON.stringify(
        {
          version: 1,
          platform: "linux",
          installRoot: dir,
          shimPath: path.join(dir, "shim"),
          realOpenClawPath: "/usr/bin/openclaw",
          servicePath: path.join(dir, "svc"),
          lastSetupAt: "2026-03-19T10:00:00.000Z"
        },
        null,
        2
      ),
      "utf8"
    );

    const originalPath = process.env.PATH;
    process.env.PATH = `${fakeBinDir}${path.delimiter}${originalPath ?? ""}`;
    try {
      const result = await runDoctor({
        routerStatePath,
        authStorePath,
        integrationStatePath
      });
      const openclawBinary = result.checks.find((check) => check.id === "openclaw_binary");
      expect(openclawBinary?.ok).toBe(true);
      expect(openclawBinary?.detail).toContain(fakeOpenClawPath);
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it("marks openclaw_binary unhealthy when active shim targets a missing real binary", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "doctor-openclaw-missing-real-"));
    cleanupPaths.push(dir);

    const homeDir = path.join(dir, "home");
    const routerStatePath = path.join(dir, "router-state.json");
    const authStorePath = path.join(dir, "auth-profiles.json");
    const integrationStatePath = path.join(dir, "integration.json");
    const shimPath = path.join(homeDir, ".openclaw-router", "bin", "openclaw");
    const missingRealOpenClawPath = path.join(dir, "missing-bin", "openclaw");

    await mkdir(path.dirname(shimPath), { recursive: true });
    await writeFile(shimPath, "#!/usr/bin/env bash\nexit 0\n", "utf8");
    await chmod(shimPath, 0o755);

    await writeFile(routerStatePath, JSON.stringify({ version: 1, accounts: [] }, null, 2), "utf8");
    await writeFile(authStorePath, JSON.stringify({ version: 1, profiles: {} }, null, 2), "utf8");
    await writeFile(
      integrationStatePath,
      JSON.stringify(
        {
          version: 1,
          platform: "linux",
          installRoot: path.join(homeDir, ".openclaw-router"),
          shimPath,
          realOpenClawPath: missingRealOpenClawPath,
          servicePath: path.join(dir, "services", "openclaw-router-repair.service"),
          lastSetupAt: "2026-03-19T10:00:00.000Z"
        },
        null,
        2
      ),
      "utf8"
    );

    const originalPath = process.env.PATH;
    process.env.PATH = `${path.dirname(shimPath)}${path.delimiter}${originalPath ?? ""}`;
    try {
      const result = await runDoctor({
        routerStatePath,
        authStorePath,
        integrationStatePath
      });
      const openclawBinary = result.checks.find((check) => check.id === "openclaw_binary");

      expect(openclawBinary?.ok).toBe(false);
      expect(openclawBinary?.detail).toContain(missingRealOpenClawPath);
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it("does not fail PATH precedence when shell profile is updated but current shell is stale", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "doctor-path-profile-"));
    cleanupPaths.push(dir);

    const homeDir = path.join(dir, "home");
    const fakeBinDir = path.join(dir, "bin");
    const fakeOpenClawPath = path.join(fakeBinDir, "openclaw");
    const routerStatePath = path.join(dir, "router-state.json");
    const authStorePath = path.join(dir, "auth-profiles.json");
    const integrationStatePath = path.join(dir, "integration.json");
    const shimPath = path.join(homeDir, ".openclaw-router", "bin", "openclaw");
    const servicePath = path.join(dir, "services", "openclaw-router-repair.service");
    const shellProfilePath = path.join(homeDir, ".profile");
    const managedBinDir = path.dirname(shimPath);

    await mkdir(fakeBinDir, { recursive: true });
    await writeFile(fakeOpenClawPath, "#!/usr/bin/env bash\nexit 0\n", "utf8");
    await chmod(fakeOpenClawPath, 0o755);

    await mkdir(path.dirname(shellProfilePath), { recursive: true });
    await writeFile(
      shellProfilePath,
      [
        "# >>> openclaw-router managed path >>>",
        `export PATH=\"${managedBinDir}:$PATH\"`,
        "# <<< openclaw-router managed path <<<",
        ""
      ].join("\n"),
      "utf8"
    );

    await mkdir(path.dirname(shimPath), { recursive: true });
    await writeFile(shimPath, "#!/usr/bin/env bash\nexit 0\n", "utf8");
    await mkdir(path.dirname(servicePath), { recursive: true });
    await writeFile(servicePath, "[Unit]\nDescription=test\n", "utf8");

    await writeFile(routerStatePath, JSON.stringify({ version: 1, accounts: [] }, null, 2), "utf8");
    await writeFile(authStorePath, JSON.stringify({ version: 1, profiles: {} }, null, 2), "utf8");
    await writeFile(
      integrationStatePath,
      JSON.stringify(
        {
          version: 1,
          platform: "linux",
          installRoot: path.join(homeDir, ".openclaw-router"),
          shimPath,
          realOpenClawPath: fakeOpenClawPath,
          servicePath,
          lastSetupAt: "2026-03-19T10:00:00.000Z"
        },
        null,
        2
      ),
      "utf8"
    );

    const originalPath = process.env.PATH;
    const originalHome = process.env.HOME;
    const originalShell = process.env.SHELL;
    process.env.PATH = `${fakeBinDir}${path.delimiter}${originalPath ?? ""}`;
    process.env.HOME = homeDir;
    process.env.SHELL = "";

    try {
      const result = await runDoctor({
        routerStatePath,
        authStorePath,
        integrationStatePath
      });
      const pathCheck = result.checks.find((check) => check.id === "integration_path_precedence");

      expect(pathCheck?.ok).toBe(true);
      expect(pathCheck?.detail).toContain("open a new shell");
    } finally {
      process.env.PATH = originalPath;
      process.env.HOME = originalHome;
      process.env.SHELL = originalShell;
    }
  });

  it("does not fail PATH precedence when zsh PATH config lives in .zshrc", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "doctor-path-zshrc-"));
    cleanupPaths.push(dir);

    const homeDir = path.join(dir, "home");
    const fakeBinDir = path.join(dir, "bin");
    const fakeOpenClawPath = path.join(fakeBinDir, "openclaw");
    const routerStatePath = path.join(dir, "router-state.json");
    const authStorePath = path.join(dir, "auth-profiles.json");
    const integrationStatePath = path.join(dir, "integration.json");
    const shimPath = path.join(homeDir, ".openclaw-router", "bin", "openclaw");
    const servicePath = path.join(dir, "services", "openclaw-router-repair.service");
    const shellProfilePath = path.join(homeDir, ".zshrc");
    const managedBinDir = path.dirname(shimPath);

    await mkdir(fakeBinDir, { recursive: true });
    await writeFile(fakeOpenClawPath, "#!/usr/bin/env bash\nexit 0\n", "utf8");
    await chmod(fakeOpenClawPath, 0o755);

    await mkdir(path.dirname(shellProfilePath), { recursive: true });
    await writeFile(
      shellProfilePath,
      [
        "# >>> openclaw-router managed path >>>",
        `export PATH=\"${managedBinDir}:$PATH\"`,
        "# <<< openclaw-router managed path <<<",
        ""
      ].join("\n"),
      "utf8"
    );

    await mkdir(path.dirname(shimPath), { recursive: true });
    await writeFile(shimPath, "#!/usr/bin/env bash\nexit 0\n", "utf8");
    await mkdir(path.dirname(servicePath), { recursive: true });
    await writeFile(servicePath, "[Unit]\nDescription=test\n", "utf8");

    await writeFile(routerStatePath, JSON.stringify({ version: 1, accounts: [] }, null, 2), "utf8");
    await writeFile(authStorePath, JSON.stringify({ version: 1, profiles: {} }, null, 2), "utf8");
    await writeFile(
      integrationStatePath,
      JSON.stringify(
        {
          version: 1,
          platform: "linux",
          installRoot: path.join(homeDir, ".openclaw-router"),
          shimPath,
          realOpenClawPath: fakeOpenClawPath,
          servicePath,
          lastSetupAt: "2026-03-19T10:00:00.000Z"
        },
        null,
        2
      ),
      "utf8"
    );

    const originalPath = process.env.PATH;
    const originalHome = process.env.HOME;
    const originalShell = process.env.SHELL;
    process.env.PATH = `${fakeBinDir}${path.delimiter}${originalPath ?? ""}`;
    process.env.HOME = homeDir;
    process.env.SHELL = "/bin/zsh";

    try {
      const result = await runDoctor({
        routerStatePath,
        authStorePath,
        integrationStatePath
      });
      const pathCheck = result.checks.find((check) => check.id === "integration_path_precedence");

      expect(pathCheck?.ok).toBe(true);
      expect(pathCheck?.detail).toContain(shellProfilePath);
    } finally {
      process.env.PATH = originalPath;
      process.env.HOME = originalHome;
      process.env.SHELL = originalShell;
    }
  });

  it("does not treat ~/.profile as valid PATH activation for zsh", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "doctor-path-zprofile-only-"));
    cleanupPaths.push(dir);

    const homeDir = path.join(dir, "home");
    const fakeBinDir = path.join(dir, "bin");
    const fakeOpenClawPath = path.join(fakeBinDir, "openclaw");
    const routerStatePath = path.join(dir, "router-state.json");
    const authStorePath = path.join(dir, "auth-profiles.json");
    const integrationStatePath = path.join(dir, "integration.json");
    const shimPath = path.join(homeDir, ".openclaw-router", "bin", "openclaw");
    const servicePath = path.join(dir, "services", "openclaw-router-repair.service");
    const profilePath = path.join(homeDir, ".profile");
    const managedBinDir = path.dirname(shimPath);

    await mkdir(fakeBinDir, { recursive: true });
    await writeFile(fakeOpenClawPath, "#!/usr/bin/env bash\nexit 0\n", "utf8");
    await chmod(fakeOpenClawPath, 0o755);

    await mkdir(path.dirname(profilePath), { recursive: true });
    await writeFile(
      profilePath,
      [
        "# >>> openclaw-router managed path >>>",
        `export PATH=\"${managedBinDir}:$PATH\"`,
        "# <<< openclaw-router managed path <<<",
        ""
      ].join("\n"),
      "utf8"
    );

    await mkdir(path.dirname(shimPath), { recursive: true });
    await writeFile(shimPath, "#!/usr/bin/env bash\nexit 0\n", "utf8");
    await mkdir(path.dirname(servicePath), { recursive: true });
    await writeFile(servicePath, "[Unit]\nDescription=test\n", "utf8");

    await writeFile(routerStatePath, JSON.stringify({ version: 1, accounts: [] }, null, 2), "utf8");
    await writeFile(authStorePath, JSON.stringify({ version: 1, profiles: {} }, null, 2), "utf8");
    await writeFile(
      integrationStatePath,
      JSON.stringify(
        {
          version: 1,
          platform: "linux",
          installRoot: path.join(homeDir, ".openclaw-router"),
          shimPath,
          realOpenClawPath: fakeOpenClawPath,
          servicePath,
          lastSetupAt: "2026-03-19T10:00:00.000Z"
        },
        null,
        2
      ),
      "utf8"
    );

    const originalPath = process.env.PATH;
    const originalHome = process.env.HOME;
    const originalShell = process.env.SHELL;
    process.env.PATH = `${fakeBinDir}${path.delimiter}${originalPath ?? ""}`;
    process.env.HOME = homeDir;
    process.env.SHELL = "/bin/zsh";

    try {
      const result = await runDoctor({
        routerStatePath,
        authStorePath,
        integrationStatePath
      });
      const pathCheck = result.checks.find((check) => check.id === "integration_path_precedence");

      expect(pathCheck?.ok).toBe(false);
      expect(pathCheck?.detail).toContain(managedBinDir);
    } finally {
      process.env.PATH = originalPath;
      process.env.HOME = originalHome;
      process.env.SHELL = originalShell;
    }
  });

  it("does not fail when HOME is missing and integration-state is omitted", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "doctor-no-home-"));
    cleanupPaths.push(dir);

    const routerStatePath = path.join(dir, "router-state.json");
    const authStorePath = path.join(dir, "auth-profiles.json");
    await writeFile(routerStatePath, JSON.stringify({ version: 1, accounts: [] }, null, 2), "utf8");
    await writeFile(authStorePath, JSON.stringify({ version: 1, profiles: {} }, null, 2), "utf8");

    const { stdout } = await execa(
      "node",
      [
        "--import",
        "tsx",
        "src/cli/main.ts",
        "doctor",
        "--router-state",
        routerStatePath,
        "--auth-store",
        authStorePath,
        "--json"
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          HOME: ""
        }
      }
    );

    const payload = JSON.parse(stdout) as { checks: Array<{ id: string }> };
    expect(payload.checks.some((check) => check.id === "openclaw_binary")).toBe(true);
  });

  it("marks openclaw_binary unhealthy when PATH entry is not executable", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "doctor-openclaw-not-executable-"));
    cleanupPaths.push(dir);

    const fakeBinDir = path.join(dir, "bin");
    const fakeOpenClawPath = path.join(fakeBinDir, "openclaw");
    const routerStatePath = path.join(dir, "router-state.json");
    const authStorePath = path.join(dir, "auth-profiles.json");

    await mkdir(fakeBinDir, { recursive: true });
    await writeFile(fakeOpenClawPath, "#!/usr/bin/env bash\nexit 0\n", "utf8");
    await chmod(fakeOpenClawPath, 0o644);

    await writeFile(routerStatePath, JSON.stringify({ version: 1, accounts: [] }, null, 2), "utf8");
    await writeFile(authStorePath, JSON.stringify({ version: 1, profiles: {} }, null, 2), "utf8");

    const originalPath = process.env.PATH;
    process.env.PATH = fakeBinDir;
    try {
      const result = await runDoctor({
        routerStatePath,
        authStorePath
      });
      const openclawBinary = result.checks.find((check) => check.id === "openclaw_binary");

      expect(openclawBinary?.ok).toBe(false);
      expect(openclawBinary?.detail).toContain("not found");
    } finally {
      process.env.PATH = originalPath;
    }
  });
});
