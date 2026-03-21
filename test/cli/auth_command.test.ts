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

      const homeDir = path.join(dir, "home");
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
        HOME: homeDir,
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
      const routerStatePath = path.join(homeDir, ".openclaw-router", "router-state.json");
      const routerState = JSON.parse(await readFile(routerStatePath, "utf8")) as {
        accounts: Array<{ alias: string; profileId: string }>;
      };

      expect(Object.keys(authStore.profiles).sort()).toEqual([
        "openai-codex:first@example.com",
        "openai-codex:second@example.com"
      ]);
      expect(authStore.order?.["openai-codex"]).toEqual([
        "openai-codex:first@example.com",
        "openai-codex:second@example.com"
      ]);
      expect(routerState.accounts.map((item) => item.alias)).toEqual(["acct-1", "acct-2"]);
      expect(routerState.accounts.map((item) => item.profileId)).toEqual([
        "openai-codex:first@example.com",
        "openai-codex:second@example.com"
      ]);
    },
    15000
  );

  it(
    "does not leave default behind when the same account logs in again",
    async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "auth-login-cli-reauth-"));
      cleanupPaths.push(dir);

      const homeDir = path.join(dir, "home");
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
            HOME: homeDir,
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

  it(
    "bypasses the managed shim and uses the real openclaw binary from integration state",
    async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "auth-login-cli-real-bin-"));
      cleanupPaths.push(dir);

      const homeDir = path.join(dir, "home");
      const authStorePath = path.join(homeDir, ".openclaw", "agents", "main", "agent", "auth-profiles.json");
      const integrationStatePath = path.join(homeDir, ".openclaw-router", "integration.json");
      const shimBinDir = path.join(dir, "shim-bin");
      const shimOpenClawPath = path.join(shimBinDir, "openclaw");
      const realBinDir = path.join(dir, "real-bin");
      const realOpenClawPath = path.join(realBinDir, "openclaw");

      await mkdir(path.dirname(authStorePath), { recursive: true });
      await mkdir(path.dirname(integrationStatePath), { recursive: true });
      await mkdir(shimBinDir, { recursive: true });
      await mkdir(realBinDir, { recursive: true });
      await writeFile(
        authStorePath,
        JSON.stringify({ version: 1, profiles: {}, order: {}, usageStats: {} }, null, 2),
        "utf8"
      );
      await writeFile(
        integrationStatePath,
        JSON.stringify(
          {
            version: 1,
            platform: "linux",
            installRoot: path.join(homeDir, ".openclaw-router"),
            shimPath: shimOpenClawPath,
            realOpenClawPath,
            servicePath: path.join(homeDir, ".openclaw-router", "services", "openclaw-router-repair.service"),
            lastSetupAt: "2026-03-21T00:00:00.000Z",
            routerStatePath: path.join(homeDir, ".openclaw-router", "router-state.json"),
            authStorePath,
            authStoreBackupPath: path.join(homeDir, ".openclaw-router", "backups", "auth-profiles.pre-router.json")
          },
          null,
          2
        ),
        "utf8"
      );
      await writeFile(
        shimOpenClawPath,
        "#!/usr/bin/env bash\nset -euo pipefail\necho shim-was-invoked >&2\nexit 99\n",
        "utf8"
      );
      await chmod(shimOpenClawPath, 0o755);
      await writeFile(
        realOpenClawPath,
        `#!/usr/bin/env bash
set -euo pipefail
auth_store="$AUTH_STORE_PATH"
node -e '
const fs = require("fs");
const [authStorePath] = process.argv.slice(1);
const raw = JSON.parse(fs.readFileSync(authStorePath, "utf8"));
const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
const payload = Buffer.from(JSON.stringify({ "https://api.openai.com/profile": { email: "real@example.com" } })).toString("base64url");
raw.profiles["openai-codex:default"] = { provider: "openai-codex", access: header + "." + payload + ".signature" };
raw.order["openai-codex"] = ["openai-codex:default"];
fs.writeFileSync(authStorePath, JSON.stringify(raw, null, 2));
' "$auth_store"
`,
        "utf8"
      );
      await chmod(realOpenClawPath, 0o755);

      const result = await execa(
        "node",
        ["--import", "tsx", "src/cli/main.ts", "auth", "login", "--auth-store", authStorePath],
        {
          cwd: repoRoot,
          env: {
            ...process.env,
            HOME: homeDir,
            PATH: `${shimBinDir}${path.delimiter}${process.env.PATH ?? ""}`,
            AUTH_STORE_PATH: authStorePath
          }
        }
      );

      const authStore = JSON.parse(await readFile(authStorePath, "utf8")) as {
        profiles: Record<string, unknown>;
      };
      const routerState = JSON.parse(
        await readFile(path.join(homeDir, ".openclaw-router", "router-state.json"), "utf8")
      ) as { accounts: Array<{ alias: string; profileId: string }> };

      expect(result.stderr).not.toContain("shim-was-invoked");
      expect(Object.keys(authStore.profiles)).toEqual(["openai-codex:real@example.com"]);
      expect(routerState.accounts.map((item) => item.profileId)).toEqual([
        "openai-codex:real@example.com"
      ]);
    },
    15000
  );

  it(
    "normalizes an existing default codex profile without invoking the real openclaw login",
    async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "auth-normalize-cli-"));
      cleanupPaths.push(dir);

      const homeDir = path.join(dir, "home");
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
              "openai-codex:default": {
                provider: "openai-codex",
                access:
                  "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJodHRwczovL2FwaS5vcGVuYWkuY29tL3Byb2ZpbGUiOnsiZW1haWwiOiJub3JtYWxpemVkQGV4YW1wbGUuY29tIn19.signature",
                refresh: "refresh-token"
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
      await writeFile(
        fakeOpenClawPath,
        "#!/usr/bin/env bash\nset -euo pipefail\necho should-not-run >&2\nexit 99\n",
        "utf8"
      );
      await chmod(fakeOpenClawPath, 0o755);

      const { stdout } = await execa(
        "node",
        ["--import", "tsx", "src/cli/main.ts", "auth", "normalize", "--auth-store", authStorePath],
        {
          cwd: repoRoot,
          env: {
            ...process.env,
            HOME: homeDir,
            PATH: `${fakeBinDir}${path.delimiter}${process.env.PATH ?? ""}`
          }
        }
      );

      expect(stdout).toContain("Normalized profiles: openai-codex:normalized@example.com");
      expect(stdout).toContain(
        "Added routed accounts: acct-1 -> openai-codex:normalized@example.com"
      );

      const authStore = JSON.parse(await readFile(authStorePath, "utf8")) as {
        profiles: Record<string, unknown>;
      };
      const routerState = JSON.parse(
        await readFile(path.join(homeDir, ".openclaw-router", "router-state.json"), "utf8")
      ) as { accounts: Array<{ alias: string; profileId: string }> };
      expect(Object.keys(authStore.profiles)).toEqual(["openai-codex:normalized@example.com"]);
      expect(routerState.accounts.map((item) => item.profileId)).toEqual([
        "openai-codex:normalized@example.com"
      ]);
    },
    15000
  );

  it(
    "falls back to PATH openclaw when integration state is unreadable",
    async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "auth-login-cli-bad-intg-"));
      cleanupPaths.push(dir);

      const homeDir = path.join(dir, "home");
      const authStorePath = path.join(dir, "auth-profiles.json");
      const integrationStatePath = path.join(homeDir, ".openclaw-router", "integration.json");
      const fakeBinDir = path.join(dir, "bin");
      const fakeOpenClawPath = path.join(fakeBinDir, "openclaw");
      await mkdir(path.dirname(authStorePath), { recursive: true });
      await mkdir(path.dirname(integrationStatePath), { recursive: true });
      await mkdir(fakeBinDir, { recursive: true });
      await writeFile(
        authStorePath,
        JSON.stringify({ version: 1, profiles: {}, order: {}, usageStats: {} }, null, 2),
        "utf8"
      );
      await writeFile(integrationStatePath, "{ invalid json", "utf8");
      await writeFile(
        fakeOpenClawPath,
        `#!/usr/bin/env bash
set -euo pipefail
auth_store="$AUTH_STORE_PATH"
node -e '
const fs = require("fs");
const [authStorePath] = process.argv.slice(1);
const raw = JSON.parse(fs.readFileSync(authStorePath, "utf8"));
const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
const payload = Buffer.from(JSON.stringify({ "https://api.openai.com/profile": { email: "pathfallback@example.com" } })).toString("base64url");
raw.profiles["openai-codex:default"] = { provider: "openai-codex", access: header + "." + payload + ".signature" };
raw.order["openai-codex"] = ["openai-codex:default"];
fs.writeFileSync(authStorePath, JSON.stringify(raw, null, 2));
' "$auth_store"
`,
        "utf8"
      );
      await chmod(fakeOpenClawPath, 0o755);

      const { stdout } = await execa(
        "node",
        [
          "--import",
          "tsx",
          "src/cli/main.ts",
          "auth",
          "login",
          "--auth-store",
          authStorePath,
          "--integration-state",
          integrationStatePath
        ],
        {
          cwd: repoRoot,
          env: {
            ...process.env,
            HOME: homeDir,
            PATH: `${fakeBinDir}${path.delimiter}${process.env.PATH ?? ""}`,
            AUTH_STORE_PATH: authStorePath
          }
        }
      );

      expect(stdout).toContain("Normalized profiles: openai-codex:pathfallback@example.com");
    },
    15000
  );

  it(
    "uses auth-store from integration state for normalize when explicit auth-store is omitted",
    async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "auth-normalize-intg-paths-"));
      cleanupPaths.push(dir);

      const homeDir = path.join(dir, "home");
      const customRoot = path.join(dir, "custom-state");
      const authStorePath = path.join(customRoot, "auth-profiles.json");
      const integrationStatePath = path.join(homeDir, ".openclaw-router", "integration.json");
      await mkdir(path.dirname(authStorePath), { recursive: true });
      await mkdir(path.dirname(integrationStatePath), { recursive: true });
      await writeFile(
        authStorePath,
        JSON.stringify(
          {
            version: 1,
            profiles: {
              "openai-codex:default": {
                provider: "openai-codex",
                access:
                  "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJodHRwczovL2FwaS5vcGVuYWkuY29tL3Byb2ZpbGUiOnsiZW1haWwiOiJpbnRnQGV4YW1wbGUuY29tIn19.signature"
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
            routerStatePath: path.join(customRoot, "router-state.json"),
            authStorePath
          },
          null,
          2
        ),
        "utf8"
      );

      const { stdout } = await execa(
        "node",
        ["--import", "tsx", "src/cli/main.ts", "auth", "normalize", "--integration-state", integrationStatePath],
        {
          cwd: repoRoot,
          env: {
            ...process.env,
            HOME: homeDir
          }
        }
      );

      expect(stdout).toContain("Normalized profiles: openai-codex:intg@example.com");

      const authStore = JSON.parse(await readFile(authStorePath, "utf8")) as {
        profiles: Record<string, unknown>;
      };
      expect(Object.keys(authStore.profiles)).toEqual(["openai-codex:intg@example.com"]);
    },
    15000
  );
});
