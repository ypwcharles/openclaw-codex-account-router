import { chmod, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { execa } from "execa";
import { fileURLToPath } from "node:url";
import { runSetup } from "../../src/integration/setup.js";

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
});
