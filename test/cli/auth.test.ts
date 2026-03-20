import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCodexAuthLogin } from "../../src/cli/commands/auth.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(cleanupPaths.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

function buildAccessTokenWithEmail(email: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      "https://api.openai.com/profile": { email }
    })
  ).toString("base64url");
  return `${header}.${payload}.signature`;
}

describe("auth login wrapper", () => {
  it("preserves multiple codex oauth accounts across repeated logins", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "auth-login-wrapper-"));
    cleanupPaths.push(dir);

    const authStorePath = path.join(dir, "auth-profiles.json");
    await mkdir(path.dirname(authStorePath), { recursive: true });
    await writeFile(
      authStorePath,
      JSON.stringify(
        {
          version: 1,
          profiles: {},
          order: {},
          usageStats: {}
        },
        null,
        2
      ),
      "utf8"
    );

    const execOpenClawLogin = vi
      .fn()
      .mockImplementationOnce(async () => {
        await writeFile(
          authStorePath,
          JSON.stringify(
            {
              version: 1,
              profiles: {
                "openai-codex:default": {
                  provider: "openai-codex",
                  access: buildAccessTokenWithEmail("first@example.com")
                }
              },
              order: {
                "openai-codex": ["openai-codex:default"]
              }
            },
            null,
            2
          ),
          "utf8"
        );
        return { exitCode: 0, stdout: "login-1", stderr: "" };
      })
      .mockImplementationOnce(async () => {
        await writeFile(
          authStorePath,
          JSON.stringify(
            {
              version: 1,
              profiles: {
                "openai-codex:first@example.com": {
                  provider: "openai-codex",
                  access: buildAccessTokenWithEmail("first@example.com")
                },
                "openai-codex:default": {
                  provider: "openai-codex",
                  access: buildAccessTokenWithEmail("second@example.com")
                }
              },
              order: {
                "openai-codex": ["openai-codex:default", "openai-codex:first@example.com"]
              }
            },
            null,
            2
          ),
          "utf8"
        );
        return { exitCode: 0, stdout: "login-2", stderr: "" };
      });

    await runCodexAuthLogin(
      {
        authStorePath,
        command: "openclaw",
        args: ["models", "auth", "login", "--provider", "openai-codex"]
      },
      { execOpenClawLogin }
    );

    await runCodexAuthLogin(
      {
        authStorePath,
        command: "openclaw",
        args: ["models", "auth", "login", "--provider", "openai-codex"]
      },
      { execOpenClawLogin }
    );

    const authStore = JSON.parse(await readFile(authStorePath, "utf8")) as {
      profiles: Record<string, unknown>;
      order?: Record<string, string[]>;
    };

    expect(Object.keys(authStore.profiles).sort()).toEqual([
      "openai-codex:first@example.com",
      "openai-codex:second@example.com"
    ]);
    expect(authStore.order?.["openai-codex"]).toEqual([
      "openai-codex:second@example.com",
      "openai-codex:first@example.com"
    ]);
  });
});
