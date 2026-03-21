import { chmod, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { execa } from "execa";
import { fileURLToPath } from "node:url";
import { runSetup } from "../../src/integration/setup.js";
import { installOpenClawShim } from "../../src/integration/shim.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cleanupPaths: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(cleanupPaths.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

describe("openclaw shim integration", () => {
  it(
    "routes a plain openclaw invocation through the shim after setup",
    async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "openclaw-shim-intg-"));
      cleanupPaths.push(dir);

    const homeDir = path.join(dir, "home");
    const authStorePath = path.join(homeDir, ".openclaw", "agents", "main", "agent", "auth-profiles.json");
    const invocationStatePath = path.join(dir, "invocations.json");
    const fixturePath = path.join(repoRoot, "test", "fixtures", "fake-openclaw-pool.mjs");

    await mkdir(path.dirname(authStorePath), { recursive: true });
    await writeFile(
      authStorePath,
      JSON.stringify(
        {
          version: 1,
          profiles: {
            "openai-codex:a@example.com": { type: "oauth", provider: "openai-codex", access: "a" },
            "openai-codex:b@example.com": { type: "oauth", provider: "openai-codex", access: "b" }
          },
          order: {},
          usageStats: {}
        },
        null,
        2
      ),
      "utf8"
    );

    const realBinDir = path.join(dir, "real-bin");
    const realOpenClawPath = path.join(realBinDir, "openclaw-real");
    await mkdir(realBinDir, { recursive: true });
    await writeFile(
      realOpenClawPath,
      `#!/usr/bin/env bash\nset -euo pipefail\nexec node ${JSON.stringify(fixturePath)} ${JSON.stringify(invocationStatePath)} "$@"\n`,
      "utf8"
    );
    await chmod(realOpenClawPath, 0o755);

    const setupResult = await runSetup(
      {
        homeDir,
        platform: "linux",
        authStorePath,
        projectRoot: repoRoot
      },
      {
        discoverOpenClawProfiles: async () => [
          "openai-codex:a@example.com",
          "openai-codex:b@example.com"
        ],
        resolveOpenClawBinary: async () => realOpenClawPath
      }
    );

    const managedBinDir = path.dirname(setupResult.shimPath);

    const result = await execa("openclaw", ["agent", "--message", "ping"], {
      env: {
        ...process.env,
        PATH: `${managedBinDir}:${realBinDir}:${process.env.PATH ?? ""}`
      },
      cwd: repoRoot
    });

    const invocations = JSON.parse(await readFile(invocationStatePath, "utf8")) as { count: number };

      expect(result.stdout).toContain("fallback-ok");
      expect(invocations.count).toBe(3);
    },
    15000
  );

  it("bypasses tui to the real openclaw binary and still routes normal commands", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "openclaw-shim-bypass-"));
    cleanupPaths.push(dir);

    const integrationStatePath = path.join(dir, "integration.json");
    const shimPath = path.join(dir, "bin", "openclaw");
    const routerCommand = path.join(dir, "bin", "openclaw-router");
    const realOpenClawPath = path.join(dir, "bin", "openclaw-real");
    const realInvocationsPath = path.join(dir, "real-invocations.log");
    const routerInvocationsPath = path.join(dir, "router-invocations.log");

    await mkdir(path.dirname(realOpenClawPath), { recursive: true });
    await writeFile(
      realOpenClawPath,
      `#!/usr/bin/env bash
set -euo pipefail
printf 'real:%s\\n' "$*" >> ${JSON.stringify(realInvocationsPath)}
exit 0
`,
      "utf8"
    );
    await chmod(realOpenClawPath, 0o755);

    await writeFile(
      routerCommand,
      `#!/usr/bin/env bash
set -euo pipefail
printf 'router:%s\\n' "$*" >> ${JSON.stringify(routerInvocationsPath)}
exit 88
`,
      "utf8"
    );
    await chmod(routerCommand, 0o755);

    await writeFile(
      integrationStatePath,
      JSON.stringify(
        {
          version: 1,
          platform: "linux",
          installRoot: dir,
          shimPath,
          realOpenClawPath,
          servicePath: path.join(dir, "service"),
          lastSetupAt: "2026-03-21T00:00:00.000Z",
          routerStatePath: path.join(dir, "router-state.json"),
          authStorePath: path.join(dir, "auth-profiles.json"),
          authStoreBackupPath: path.join(dir, "auth-profiles.backup.json")
        },
        null,
        2
      ),
      "utf8"
    );

    await installOpenClawShim({
      shimPath,
      routerCommand,
      integrationStatePath
    });

    const tuiResult = await execa(shimPath, ["tui"], { reject: false });
    expect(tuiResult.exitCode).toBe(0);
    expect(await readFile(realInvocationsPath, "utf8")).toContain("real:tui");

    const routedResult = await execa(shimPath, ["agent", "--message", "ping"], { reject: false });
    expect(routedResult.exitCode).toBe(88);
    expect(await readFile(routerInvocationsPath, "utf8")).toContain("router:run --integration-state");
    expect(await readFile(routerInvocationsPath, "utf8")).toContain("agent --message ping");
  });
});
