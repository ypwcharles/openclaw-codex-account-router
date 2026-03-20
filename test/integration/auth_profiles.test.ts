import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import lockfile from "proper-lockfile";
import { normalizeCodexAuthProfiles } from "../../src/integration/auth_profiles.js";
import { getOpenClawAuthLockPath } from "../../src/router/openclaw_auth_lock.js";

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

describe("auth profile normalization", () => {
  it("reuses the shared openclaw auth lock file path", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "auth-profile-lock-"));
    cleanupPaths.push(dir);

    const authStorePath = path.join(dir, "auth-profiles.json");
    await mkdir(path.dirname(authStorePath), { recursive: true });
    await writeFile(
      authStorePath,
      JSON.stringify(
        {
          version: 1,
          profiles: {
            "openai-codex:default": {
              provider: "openai-codex",
              access: buildAccessTokenWithEmail("lock@example.com")
            }
          }
        },
        null,
        2
      ),
      "utf8"
    );

    const authLockPath = path.join(dir, ".openclaw-auth-profiles.lock");
    const release = await lockfile.lock(dir, {
      lockfilePath: getOpenClawAuthLockPath(authStorePath),
      retries: 0
    });

    let settled = false;
    const normalizePromise = normalizeCodexAuthProfiles(authStorePath).finally(() => {
      settled = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(settled).toBe(false);

    await release();
    await normalizePromise;

    const normalizedStore = JSON.parse(await readFile(authStorePath, "utf8")) as {
      profiles: Record<string, unknown>;
    };

    expect(Object.keys(normalizedStore.profiles)).toEqual(["openai-codex:lock@example.com"]);
    await readFile(authLockPath, "utf8").catch(() => "");
  });
});
