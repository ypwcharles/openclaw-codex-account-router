import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
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

describe("run cli integration", () => {
  it("uses real child process and succeeds on fallback run after codex pool exhaustion", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "run-cli-integration-"));
    cleanupPaths.push(dir);
    const routerStatePath = path.join(dir, "router-state.json");
    const authStorePath = path.join(dir, "auth-profiles.json");
    const invocationStatePath = path.join(dir, "invocations.json");
    const fixturePath = path.join(repoRoot, "test", "fixtures", "fake-openclaw-pool.mjs");

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
            },
            {
              alias: "acct-b",
              profileId: "openai-codex:b@example.com",
              provider: "openai-codex",
              priority: 20,
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

    const { stdout } = await execa(
      "node",
      [
        "--import",
        "tsx",
        "src/cli/main.ts",
        "run",
        "--router-state",
        routerStatePath,
        "--auth-store",
        authStorePath,
        "--json",
        "node",
        fixturePath,
        invocationStatePath
      ],
      { cwd: repoRoot }
    );

    const payload = JSON.parse(stdout) as {
      poolExhausted: boolean;
      usedProfileIds: string[];
      result?: { stdout: string };
    };
    const invocations = JSON.parse(await readFile(invocationStatePath, "utf8")) as { count: number };

    expect(payload.poolExhausted).toBe(true);
    expect(payload.usedProfileIds).toEqual([
      "openai-codex:a@example.com",
      "openai-codex:b@example.com"
    ]);
    expect(payload.result?.stdout).toContain("fallback-ok");
    expect(invocations.count).toBe(3);
  });

  it("auto-loads router/auth paths from default integration state", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "run-cli-default-intg-"));
    cleanupPaths.push(dir);

    const homeDir = path.join(dir, "home");
    const routerStatePath = path.join(dir, "router-state.json");
    const authStorePath = path.join(dir, "auth-profiles.json");
    const integrationStatePath = path.join(homeDir, ".openclaw-router", "integration.json");
    const invocationStatePath = path.join(dir, "invocations.json");
    const fixturePath = path.join(repoRoot, "test", "fixtures", "fake-openclaw-pool.mjs");

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
            },
            {
              alias: "acct-b",
              profileId: "openai-codex:b@example.com",
              provider: "openai-codex",
              priority: 20,
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

    await mkdir(path.dirname(integrationStatePath), { recursive: true });
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
      ["--import", "tsx", "src/cli/main.ts", "run", "--json", "node", fixturePath, invocationStatePath],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          HOME: homeDir
        }
      }
    );

    const payload = JSON.parse(stdout) as {
      usedProfileIds: string[];
      poolExhausted: boolean;
      result?: { stdout: string };
    };
    const invocations = JSON.parse(await readFile(invocationStatePath, "utf8")) as { count: number };

    expect(payload.usedProfileIds).toEqual([
      "openai-codex:a@example.com",
      "openai-codex:b@example.com"
    ]);
    expect(payload.poolExhausted).toBe(true);
    expect(payload.result?.stdout).toContain("fallback-ok");
    expect(invocations.count).toBe(3);
  });
});
