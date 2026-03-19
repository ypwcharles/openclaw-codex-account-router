# OpenClaw Codex Account Router Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an external router/wrapper that keeps `openai-codex` traffic inside the Codex account pool first, and only lets OpenClaw fall through to MiniMax after every Codex account is in cooldown or disabled.

**Architecture:** Keep router-owned account metadata in this repo, but mirror runtime health into OpenClaw's `auth-profiles.json` so upstream profile rotation and model fallback keep doing the heavy lifting. Use a small TypeScript CLI to manage alias-to-profile bindings, classify Codex-specific failures such as `deactivated_workspace`, write cooldown or disable state back into both stores, and rerun the same OpenClaw command until either a healthy Codex profile succeeds or the Codex pool is exhausted.

**Tech Stack:** Node.js 20+, TypeScript, `pnpm`, Vitest, Commander, Zod, `execa`, `proper-lockfile`

---

## Validated Upstream Facts

- Upstream `openclaw` `main` at commit `c4a4050ce48b5abd62bed82263a5472639dd8b25` on 2026-03-19 already exposes `openai-codex` as a bundled provider plugin, not a hard-coded dist-only path.
- `extensions/openai/openai-codex-provider.ts` builds provider auth through the generic plugin SDK and creates OAuth profiles via `buildOauthProviderAuthResult(...)`.
- OAuth profile IDs are still derived as `provider:<email>` or `provider:default`; there is still no `models auth login --provider openai-codex --profile-id ...` support.
- `src/agents/auth-profiles/order.ts` and `src/agents/auth-profiles/usage.ts` already provide per-provider order, cooldown, disable, and failure-count semantics that we can mirror instead of reinventing.
- `deactivated_workspace` is not explicitly matched in upstream failover classification today, so the wrapper must normalize that error into `auth_permanent`.

## Recommended Approach

Implement **Approach A**:

1. This repo owns a small router state file with `alias`, `profileId`, health, timestamps, and operator metadata.
2. A bridge layer reads and writes OpenClaw's `auth-profiles.json` with file locking so router decisions become visible to OpenClaw's native auth-profile rotation.
3. A wrapper command executes an OpenClaw run, classifies failures, marks the current Codex profile as cooldown or disabled, and retries.
4. When all Codex profiles are unavailable, the wrapper stops forcing Codex recovery and lets OpenClaw's existing model fallback chain reach MiniMax.

Reject for MVP:

- A full HTTP reverse proxy in front of the gateway. Too much surface area for the first cut.
- A direct upstream core patch. Useful later, but not required for a working MVP on current upstream.
- A purely manual account switcher. That would miss the runtime recovery requirement.

### Task 1: Bootstrap the TypeScript CLI project

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `src/index.ts`
- Create: `src/cli/main.ts`
- Test: `test/cli/help.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { execa } from "execa";

describe("cli help", () => {
  it("shows the status and run commands", async () => {
    const { stdout } = await execa("node", ["--import", "tsx", "src/cli/main.ts", "--help"]);
    expect(stdout).toContain("status");
    expect(stdout).toContain("run");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/cli/help.test.ts`
Expected: FAIL because the CLI entrypoint and package scaffolding do not exist yet.

**Step 3: Write minimal implementation**

```ts
import { Command } from "commander";

const program = new Command();
program.name("codex-account-router");
program.command("status").description("Show router status");
program.command("run").description("Run OpenClaw with Codex account routing");
program.parseAsync(process.argv);
```

Add scripts:

```json
{
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "dev": "tsx src/cli/main.ts"
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/cli/help.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts .gitignore src/index.ts src/cli/main.ts test/cli/help.test.ts
git commit -m "chore: bootstrap codex account router cli"
```

### Task 2: Create router-owned account state and persistence

**Files:**
- Create: `config/accounts.example.json`
- Create: `src/account_store/schema.ts`
- Create: `src/account_store/store.ts`
- Create: `src/account_store/types.ts`
- Test: `test/account_store/store.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { loadRouterState, saveRouterState } from "../../src/account_store/store";

describe("router state store", () => {
  it("round-trips accounts and preserves priority order", async () => {
    const state = {
      version: 1,
      accounts: [
        { alias: "acct-a", profileId: "openai-codex:a@example.com", provider: "openai-codex", priority: 10, status: "healthy" },
        { alias: "acct-b", profileId: "openai-codex:b@example.com", provider: "openai-codex", priority: 20, status: "cooldown" }
      ]
    };
    await saveRouterState("/tmp/router-state.json", state);
    const loaded = await loadRouterState("/tmp/router-state.json");
    expect(loaded.accounts.map((x) => x.alias)).toEqual(["acct-a", "acct-b"]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/account_store/store.test.ts`
Expected: FAIL because the schema and store functions do not exist.

**Step 3: Write minimal implementation**

Use a strict schema:

```ts
export const RouterAccountSchema = z.object({
  alias: z.string().min(1),
  profileId: z.string().min(1),
  provider: z.literal("openai-codex"),
  priority: z.number().int().nonnegative(),
  status: z.enum(["healthy", "cooldown", "disabled", "unknown"]),
  lastSuccessAt: z.string().datetime().optional(),
  lastFailureAt: z.string().datetime().optional(),
  lastErrorCode: z.string().optional(),
  cooldownUntil: z.string().datetime().optional(),
  enabled: z.boolean().default(true),
});
```

Persist with atomic write and a lock:

```ts
await lockfile.lock(path.dirname(statePath), { lockfilePath: `${statePath}.lock` });
await fs.writeFile(`${statePath}.tmp`, JSON.stringify(state, null, 2));
await fs.rename(`${statePath}.tmp`, statePath);
```

Ship `config/accounts.example.json` with two example Codex accounts and one MiniMax note in comments or README text, not executable fallback config.

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/account_store/store.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add config/accounts.example.json src/account_store/types.ts src/account_store/schema.ts src/account_store/store.ts test/account_store/store.test.ts
git commit -m "feat: add router account state store"
```

### Task 3: Build the OpenClaw auth-store bridge

**Files:**
- Create: `src/router/openclaw_paths.ts`
- Create: `src/router/openclaw_auth_store.ts`
- Create: `src/router/openclaw_usage_mirror.ts`
- Test: `test/router/openclaw_auth_store.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { syncCodexOrder, mirrorFailureToOpenClaw } from "../../src/router/openclaw_auth_store";

describe("openclaw auth bridge", () => {
  it("writes explicit order and disabled state into auth-profiles.json", async () => {
    const authPath = await writeFixtureAuthStore();
    await syncCodexOrder(authPath, ["openai-codex:b@example.com", "openai-codex:a@example.com"]);
    await mirrorFailureToOpenClaw(authPath, {
      profileId: "openai-codex:a@example.com",
      reason: "auth_permanent",
      now: new Date("2026-03-19T12:00:00Z"),
    });
    const next = await readFixtureAuthStore(authPath);
    expect(next.order["openai-codex"][0]).toBe("openai-codex:b@example.com");
    expect(next.usageStats["openai-codex:a@example.com"].disabledReason).toBe("auth_permanent");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/router/openclaw_auth_store.test.ts`
Expected: FAIL because the bridge layer does not exist.

**Step 3: Write minimal implementation**

Mirror the upstream shape exactly:

```ts
type OpenClawAuthStore = {
  version: number;
  profiles: Record<string, unknown>;
  order?: Record<string, string[]>;
  lastGood?: Record<string, string>;
  usageStats?: Record<string, {
    lastUsed?: number;
    cooldownUntil?: number;
    disabledUntil?: number;
    disabledReason?: string;
    errorCount?: number;
    failureCounts?: Record<string, number>;
    lastFailureAt?: number;
  }>;
};
```

Match upstream cooldown rules:

```ts
const cooldownMs = Math.min(60 * 60 * 1000, 60 * 1000 * 5 ** Math.min(errorCount - 1, 3));
const disabledMs = Math.min(24 * 60 * 60 * 1000, 5 * 60 * 60 * 1000 * 2 ** Math.min(errorCount - 1, 10));
```

Important implementation rule:

- Never rewrite unknown providers.
- Only mutate `order["openai-codex"]`, `usageStats[profileId]`, and `lastGood["openai-codex"]`.
- Use file locking before reading and writing.

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/router/openclaw_auth_store.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/router/openclaw_paths.ts src/router/openclaw_auth_store.ts src/router/openclaw_usage_mirror.ts test/router/openclaw_auth_store.test.ts
git commit -m "feat: mirror router state into openclaw auth store"
```

### Task 4: Implement account bind and profile normalization commands

**Files:**
- Create: `src/account_store/bind.ts`
- Create: `src/cli/commands/accounts.ts`
- Test: `test/account_store/bind.test.ts`
- Test: `test/cli/accounts.test.ts`

**Step 1: Write the failing test**

```ts
describe("bind account", () => {
  it("binds alias to a concrete openai-codex profile id", async () => {
    const result = await bindAccount({
      alias: "acct-a",
      profileId: "openai-codex:user@example.com",
      routerStatePath,
      authStorePath,
    });
    expect(result.account.alias).toBe("acct-a");
    expect(result.account.profileId).toBe("openai-codex:user@example.com");
  });

  it("refuses ambiguous default-profile rebinding without force", async () => {
    await expect(bindAccount({
      alias: "acct-a",
      profileId: "openai-codex:default",
      routerStatePath,
      authStorePath,
    })).rejects.toThrow("ambiguous");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/account_store/bind.test.ts test/cli/accounts.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

Support these commands:

```ts
accounts bind --alias acct-a --profile-id openai-codex:user@example.com
accounts list
accounts enable acct-a
accounts disable acct-a
accounts order set acct-a acct-b acct-c
```

Binding rules:

- Require `profileId` for MVP.
- If `profileId === "openai-codex:default"`, require `--force-default` and store a fingerprint of refresh-token hash so future collisions are detectable.
- Copy the bound priority into both router state and OpenClaw `order["openai-codex"]`.

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/account_store/bind.test.ts test/cli/accounts.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/account_store/bind.ts src/cli/commands/accounts.ts test/account_store/bind.test.ts test/cli/accounts.test.ts
git commit -m "feat: add account bind and ordering commands"
```

### Task 5: Implement the Codex-specific error classifier

**Files:**
- Create: `docs/error-taxonomy.md`
- Create: `src/classifier/codex_error_classifier.ts`
- Test: `test/classifier/codex_error_classifier.test.ts`

**Step 1: Write the failing test**

```ts
describe("codex error classifier", () => {
  it("maps ChatGPT usage limit to rate_limit", () => {
    expect(classifyCodexFailure("You have hit your ChatGPT usage limit (team plan)")).toMatchObject({
      reason: "rate_limit",
      action: "cooldown",
    });
  });

  it("maps deactivated_workspace to auth_permanent", () => {
    expect(classifyCodexFailure('{\"detail\":{\"code\":\"deactivated_workspace\"}}')).toMatchObject({
      reason: "auth_permanent",
      action: "disable",
    });
  });

  it("maps invalid_grant to auth_permanent", () => {
    expect(classifyCodexFailure("invalid_grant")).toMatchObject({
      reason: "auth_permanent",
      action: "disable",
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/classifier/codex_error_classifier.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

Start with a pure function:

```ts
export function classifyCodexFailure(raw: string): {
  reason: "rate_limit" | "auth_permanent" | "billing" | "timeout" | "unknown";
  action: "cooldown" | "disable" | "retry";
  normalizedCode: string;
} {
  const text = raw.toLowerCase();
  if (text.includes("deactivated_workspace")) return { reason: "auth_permanent", action: "disable", normalizedCode: "deactivated_workspace" };
  if (text.includes("invalid_grant") || text.includes("auth revoked") || text.includes("workspace disabled")) {
    return { reason: "auth_permanent", action: "disable", normalizedCode: "auth_revoked" };
  }
  if (text.includes("usage limit") || text.includes("429") || text.includes("retry-after") || text.includes("insufficient_quota")) {
    return { reason: "rate_limit", action: "cooldown", normalizedCode: "rate_limit" };
  }
  if (text.includes("timeout") || text.includes("timed out") || text.includes("econnreset")) {
    return { reason: "timeout", action: "retry", normalizedCode: "timeout" };
  }
  return { reason: "unknown", action: "retry", normalizedCode: "unknown" };
}
```

Document the mapping table in `docs/error-taxonomy.md`, including:

- source pattern
- normalized reason
- router action
- OpenClaw mirror target (`cooldownUntil` or `disabledUntil`)

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/classifier/codex_error_classifier.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add docs/error-taxonomy.md src/classifier/codex_error_classifier.ts test/classifier/codex_error_classifier.test.ts
git commit -m "feat: add codex error taxonomy"
```

### Task 6: Build the runtime retry router

**Files:**
- Create: `src/router/select_account.ts`
- Create: `src/router/run_with_codex_pool.ts`
- Create: `src/router/openclaw_exec.ts`
- Create: `src/router/result.ts`
- Test: `test/router/run_with_codex_pool.test.ts`

**Step 1: Write the failing test**

```ts
describe("runWithCodexPool", () => {
  it("cooldowns account A and retries with account B before pool exhaustion", async () => {
    const exec = vi.fn()
      .mockRejectedValueOnce(new Error("You have hit your ChatGPT usage limit (team plan)"))
      .mockResolvedValueOnce({ exitCode: 0, stdout: "ok", stderr: "" });

    const result = await runWithCodexPool({
      execOpenClaw: exec,
      accounts: [
        makeAccount("acct-a", "openai-codex:a@example.com", 10),
        makeAccount("acct-b", "openai-codex:b@example.com", 20),
      ],
    });

    expect(result.usedProfileIds).toEqual([
      "openai-codex:a@example.com",
      "openai-codex:b@example.com",
    ]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/router/run_with_codex_pool.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

Execution loop:

```ts
for (const account of eligibleAccounts) {
  await syncCodexOrder(authStorePath, [account.profileId, ...otherEligibleIds]);
  try {
    const result = await execOpenClaw(command, args, env);
    await markSuccess(routerState, authStorePath, account.profileId);
    return result;
  } catch (error) {
    const classified = classifyCodexFailure(stringifyError(error));
    await applyFailure(routerState, authStorePath, account.profileId, classified);
    if (classified.action === "retry") {
      continue;
    }
  }
}
return { poolExhausted: true };
```

Router rules:

- `rate_limit` => cooldown current profile, retry next Codex account.
- `auth_permanent` and `billing` => disable current profile, retry next Codex account.
- `timeout` => retry current profile once, then cooldown and move on.
- All profiles unavailable => return a structured `poolExhausted` result so the caller can hand control back to OpenClaw's existing MiniMax fallback chain.

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/router/run_with_codex_pool.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/router/select_account.ts src/router/run_with_codex_pool.ts src/router/openclaw_exec.ts src/router/result.ts test/router/run_with_codex_pool.test.ts
git commit -m "feat: add codex pool runtime router"
```

### Task 7: Expose operator commands and acceptance coverage

**Files:**
- Create: `src/cli/commands/status.ts`
- Create: `src/cli/commands/run.ts`
- Create: `src/cli/commands/doctor.ts`
- Create: `docs/routing-strategy.md`
- Create: `README.md`
- Test: `test/cli/status.test.ts`
- Test: `test/cli/run.test.ts`
- Test: `test/acceptance/requirements.test.ts`

**Step 1: Write the failing test**

```ts
describe("requirements acceptance", () => {
  it("scenario 1: usage limit stays inside codex pool", async () => {
    const result = await runScenario("usage-limit");
    expect(result.fellBackToMiniMax).toBe(false);
    expect(result.finalProvider).toBe("openai-codex");
  });

  it("scenario 2: deactivated workspace disables current account", async () => {
    const result = await runScenario("deactivated-workspace");
    expect(result.disabledProfiles).toContain("openai-codex:a@example.com");
    expect(result.finalProvider).toBe("openai-codex");
  });

  it("scenario 3: exhausted codex pool permits minimax", async () => {
    const result = await runScenario("pool-exhausted");
    expect(result.poolExhausted).toBe(true);
    expect(result.allowedProviderFallback).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/cli/status.test.ts test/cli/run.test.ts test/acceptance/requirements.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

Add commands:

```bash
codex-account-router status
codex-account-router accounts list
codex-account-router accounts disable acct-a
codex-account-router accounts enable acct-a
codex-account-router cooldown clear acct-a
codex-account-router doctor
codex-account-router run -- openclaw agent --message "..."
```

`status` output must include:

- current ordered Codex account list
- active eligible accounts
- cooldown or disable expiry
- last error code
- next candidate
- last provider-fallback reason

`doctor` checks must include:

- `openclaw` binary exists
- `auth-profiles.json` readable and writable
- every router alias points to a real `openai-codex` profile
- duplicate use of `openai-codex:default`

Document the runtime flow in `docs/routing-strategy.md` and usage instructions in `README.md`.

**Step 4: Run test to verify it passes**

Run: `pnpm test`
Expected: PASS

**Step 5: Commit**

```bash
git add src/cli/commands/status.ts src/cli/commands/run.ts src/cli/commands/doctor.ts docs/routing-strategy.md README.md test/cli/status.test.ts test/cli/run.test.ts test/acceptance/requirements.test.ts
git commit -m "feat: add operator commands and acceptance coverage"
```

## Verification Checklist

Run these before claiming the MVP is complete:

1. `pnpm install`
2. `pnpm test`
3. `pnpm build`
4. `node --import tsx src/cli/main.ts status --json`
5. `node --import tsx src/cli/main.ts doctor`
6. Manual dry run with two fake Codex profiles and one simulated `usage limit`
7. Manual dry run with one fake `deactivated_workspace`

## Notes For The Implementer

- Keep all OpenClaw-specific constants in one place so upstream drift is easy to patch later.
- Match upstream cooldown numbers exactly in MVP to avoid operator confusion.
- Treat `openai-codex:default` as a hazard, not as a stable identity.
- Do not add a networked admin API in MVP; local CLI commands are enough.
- Keep the wrapper stateless during a single process except for explicit store writes; the JSON stores are the source of truth.

Plan complete and saved to `docs/plans/2026-03-19-openclaw-codex-account-router.md`. Two execution options:

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?**
