import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
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

describe("auth login cli", () => {
  it(
    "keeps multiple codex oauth accounts across repeated wrapped logins",
    async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "auth-login-cli-"));
      cleanupPaths.push(dir);

      const authStorePath = path.join(dir, "auth-profiles.json");
      const fakeBinDir = path.join(dir, "bin");
      const fakeOpenClawPath = path.join(fakeBinDir, "openclaw");
      await mkdir(path.dirname(authStorePath), { recursive: true });
      await mkdir(fakeBinDir, { recursive: true });
      await writeFile(
        authStorePath,
        JSON.stringify({ version: 1, profiles: {}, order: {}, usageStats: {} }, null, 2),
        "utf8"
      );
      await writeFile(
        fakeOpenClawPath,
        `#!/usr/bin/env bash
set -euo pipefail
auth_store="$AUTH_STORE_PATH"
email="$LOGIN_EMAIL"
node -e '
const fs = require("fs");
const path = require("path");
const [authStorePath, email] = process.argv.slice(1);
const raw = fs.existsSync(authStorePath)
  ? JSON.parse(fs.readFileSync(authStorePath, "utf8"))
  : { version: 1, profiles: {}, order: {}, usageStats: {} };
const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
const payload = Buffer.from(JSON.stringify({ "https://api.openai.com/profile": { email } })).toString("base64url");
const access = \`\${header}.\${payload}.signature\`;
const existingProfiles = Object.fromEntries(
  Object.entries(raw.profiles || {}).filter(([profileId]) => profileId !== "openai-codex:default")
);
raw.profiles = {
  ...existingProfiles,
  "openai-codex:default": { provider: "openai-codex", access }
};
const existingOrder = Array.isArray(raw.order?.["openai-codex"]) ? raw.order["openai-codex"] : [];
raw.order = {
  ...(raw.order || {}),
  "openai-codex": ["openai-codex:default", ...existingOrder.filter((profileId) => profileId !== "openai-codex:default")]
};
fs.mkdirSync(path.dirname(authStorePath), { recursive: true });
fs.writeFileSync(authStorePath, JSON.stringify(raw, null, 2));
' "$auth_store" "$email"
`,
        "utf8"
      );
      await chmod(fakeOpenClawPath, 0o755);

      const baseEnv = {
        ...process.env,
        PATH: `${fakeBinDir}${path.delimiter}${process.env.PATH ?? ""}`,
        AUTH_STORE_PATH: authStorePath
      };

      await execa(
        "node",
        ["--import", "tsx", "src/cli/main.ts", "auth", "login", "--auth-store", authStorePath],
        {
          cwd: repoRoot,
          env: {
            ...baseEnv,
            LOGIN_EMAIL: "first@example.com"
          }
        }
      );

      await execa(
        "node",
        ["--import", "tsx", "src/cli/main.ts", "auth", "login", "--auth-store", authStorePath],
        {
          cwd: repoRoot,
          env: {
            ...baseEnv,
            LOGIN_EMAIL: "second@example.com"
          }
        }
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
    },
    15000
  );

  it(
    "does not leave default behind when the same account logs in again",
    async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "auth-login-cli-reauth-"));
      cleanupPaths.push(dir);

      const authStorePath = path.join(dir, "auth-profiles.json");
      const fakeBinDir = path.join(dir, "bin");
      const fakeOpenClawPath = path.join(fakeBinDir, "openclaw");
      await mkdir(path.dirname(authStorePath), { recursive: true });
      await mkdir(fakeBinDir, { recursive: true });
      await writeFile(
        authStorePath,
        JSON.stringify(
          {
            version: 1,
            profiles: {
              "openai-codex:first@example.com": {
                provider: "openai-codex",
                access: "old-access",
                refresh: "old-refresh"
              }
            },
            order: {
              "openai-codex": ["openai-codex:first@example.com"]
            },
            usageStats: {
              "openai-codex:first@example.com": {
                cooldownUntil: 12345
              }
            }
          },
          null,
          2
        ),
        "utf8"
      );
      await writeFile(
        fakeOpenClawPath,
        `#!/usr/bin/env bash
set -euo pipefail
auth_store="$AUTH_STORE_PATH"
email="$LOGIN_EMAIL"
node -e '
const fs = require("fs");
const [authStorePath, email] = process.argv.slice(1);
const raw = JSON.parse(fs.readFileSync(authStorePath, "utf8"));
const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
const payload = Buffer.from(JSON.stringify({ "https://api.openai.com/profile": { email } })).toString("base64url");
const access = header + "." + payload + ".signature";
raw.profiles["openai-codex:default"] = { provider: "openai-codex", access, refresh: "new-refresh" };
raw.order["openai-codex"] = ["openai-codex:default", "openai-codex:first@example.com"];
raw.usageStats["openai-codex:default"] = { cooldownUntil: 67890 };
fs.writeFileSync(authStorePath, JSON.stringify(raw, null, 2));
' "$auth_store" "$email"
`,
        "utf8"
      );
      await chmod(fakeOpenClawPath, 0o755);

      await execa(
        "node",
        ["--import", "tsx", "src/cli/main.ts", "auth", "login", "--auth-store", authStorePath],
        {
          cwd: repoRoot,
          env: {
            ...process.env,
            PATH: `${fakeBinDir}${path.delimiter}${process.env.PATH ?? ""}`,
            AUTH_STORE_PATH: authStorePath,
            LOGIN_EMAIL: "first@example.com"
          }
        }
      );

      const authStore = JSON.parse(await readFile(authStorePath, "utf8")) as {
        profiles: Record<string, { refresh?: string }>;
        order?: Record<string, string[]>;
        usageStats?: Record<string, { cooldownUntil?: number }>;
      };

      expect(Object.keys(authStore.profiles)).toEqual(["openai-codex:first@example.com"]);
      expect(authStore.profiles["openai-codex:first@example.com"]?.refresh).toBe("new-refresh");
      expect(authStore.order?.["openai-codex"]).toEqual(["openai-codex:first@example.com"]);
      expect(authStore.usageStats?.["openai-codex:first@example.com"]?.cooldownUntil).toBe(67890);
      expect(authStore.usageStats?.["openai-codex:default"]).toBeUndefined();
    },
    15000
  );
});
