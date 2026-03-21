# AGENTS.md

If you are an agent operating inside this repository, read this first.

## Mission

This project is a local OpenClaw router for `openai-codex` multi-account failover, with managed install artifacts for user-facing `openclaw-router` usage.

Required behavior:

- Keep traffic inside the Codex account pool first.
- Mirror router decisions into OpenClaw auth state.
- Allow cross-provider fallback only after the Codex pool is exhausted.
- Keep managed shim behavior reversible and inspectable.

## Fast mental model

```text
setup -> discover codex profiles -> install shim/service -> persist integration state
      -> snapshot auth-profiles.json for restore
shim invocation -> openclaw-router run -> select Codex account -> sync OpenClaw order
                -> run openclaw -> classify failure -> cooldown/disable/retry
                -> if pool exhausted: allow one fallback run
```

## Files that matter most

Read these before changing behavior:

- Router store and schema
  - `src/account_store/schema.ts`
  - `src/account_store/store.ts`
  - `src/account_store/bind.ts`
- OpenClaw bridge
  - `src/router/openclaw_auth_store.ts`
  - `src/router/openclaw_usage_mirror.ts`
  - `src/router/run_with_codex_pool.ts`
  - `src/router/select_account.ts`
- Integration layer
  - `src/integration/setup.ts`
  - `src/integration/repair.ts`
  - `src/integration/shim.ts`
  - `src/integration/store.ts`
  - `src/integration/service_templates.ts`
- CLI contract
  - `src/cli/main.ts`
- `src/cli/commands/setup.ts`
  - `src/cli/commands/auth.ts`
  - `src/cli/commands/account.ts`
  - `src/cli/commands/status.ts`
  - `src/cli/commands/doctor.ts`
  - `src/cli/commands/run.ts`
  - `src/cli/commands/repair.ts`

## Behavioral invariants

Do not break these:

- `openai-codex:default` binding requires explicit `--force-default` for manual bind flows.
- `account enable` / `accounts enable` must make an account routable again.
- `cooldown clear` must only clear cooldown semantics, not disabled semantics.
- Router cooldown timestamps should match OpenClaw mirrored cooldown timestamps.
- `run` must do one final fallback execution after pool exhaustion.
- `status.cooldowns` should show only active cooldown entries.
- Shimmed `openclaw ...` must preserve original CLI args and route through `run`.
- `setup` must preserve a restore snapshot of OpenClaw auth store.

## Action norms

Convert hard-won debugging lessons into default engineering behavior:

- Reuse upstream OpenClaw auth flows whenever possible. The router should prefer post-login normalization and account binding over re-implementing OAuth.
- When CLI path flags are omitted, resolve state from persisted integration state first, then installed defaults under `~/.openclaw-router`, and only use ad hoc cwd-based fallbacks as a last resort.
- Treat path comparisons as filesystem identity checks, not string checks. Canonicalize existing paths with `realpath()` before exclusion or equality logic.
- Treat executable discovery as file discovery. A PATH candidate is only valid if it is a regular file and executable.
- Keep shim scope narrow, but preserve routing invariants. Do not bypass shimmed commands around `run` if that would skip Codex-pool selection, cooldown bookkeeping, or OpenClaw usage mirroring.
- Every shim must defend against self-recursion explicitly, even if setup logic is supposed to prevent it.
- When a command reads or writes router state, auth store, or integration state, make the source of truth obvious and consistent across commands.

## Command surface

Primary user-facing CLI:

- `setup [--home-dir <path>] [--platform <darwin|linux>] [--router-state <path>] [--auth-store <path>] [--integration-state <path>] [--json]`
- `auth login [--auth-store <path>] [--integration-state <path>] [--json]`
- `auth normalize [--auth-store <path>] [--integration-state <path>] [--json]`
- `status [--router-state <path>] [--integration-state <path>] [--json]`
- `doctor [--router-state <path>] [--auth-store <path>] [--integration-state <path>] [--json]`
- `run [--router-state <path>] [--auth-store <path>] [--integration-state <path>] [--json] [commandArgs...]`
- `repair [--integration-state <path>] [--json]`
- `restore [--integration-state <path>] [--auth-store <path>] [--json]`
- `account list [--router-state <path>] [--integration-state <path>]`
- `account add --profile-id <id> [--alias <alias>] [--priority <n>] [--force-default] [--router-state <path>] [--auth-store <path>] [--integration-state <path>]`
- `account enable <alias> [--router-state <path>] [--auth-store <path>] [--integration-state <path>]`
- `account disable <alias> [--router-state <path>] [--auth-store <path>] [--integration-state <path>]`
- `account order <aliases...> [--router-state <path>] [--auth-store <path>] [--integration-state <path>]`

Compatibility commands still supported:

- `accounts bind/list/enable/disable/order set [--integration-state <path>]`
- `cooldown clear <alias> [--router-state <path>] [--auth-store <path>] [--integration-state <path>]`

Keep docs and tests aligned if this changes.

## Test requirements

Use TDD for behavior changes:

1. Write or adjust a failing test first.
2. Run the targeted test and verify it fails for the expected reason.
3. Implement the minimal fix.
4. Re-run the targeted test.
5. Run full `pnpm test`.
6. Run `pnpm build`.

Extra rules:

- Runtime CLI changes should keep at least one real-process integration test.
- Acceptance behavior belongs in `test/acceptance/requirements.test.ts`.
- Avoid mock-only confidence for pool exhaustion and fallback logic.
- Path-resolution changes should include at least one test that runs from a non-repo cwd or installed-home layout.
- Binary discovery or shim exclusion changes should include at least one symlink-path regression test.

## Validation gate

Before claiming completion:

```bash
pnpm test
pnpm build
```

If command behavior changed, also run representative CLI commands manually.

## Scope discipline

- Do not add a network admin API for this project.
- Do not change unrelated OpenClaw provider behavior.
- Prefer small, explicit edits over broad refactors.
- Keep OpenClaw-facing constants and semantics easy to patch when upstream changes.

## Environment assumptions

- Integration root default path: `~/.openclaw-router`
- Integration state default path: `~/.openclaw-router/integration.json`
- OpenClaw auth store default path: `~/.openclaw/agents/main/agent/auth-profiles.json`
- `openclaw` is expected in `PATH`

## Superpowers

This repo expects Superpowers via native skill discovery:

1. Clone to `~/.codex/superpowers`
2. Symlink `~/.agents/skills/superpowers` -> `~/.codex/superpowers/skills`
3. Restart Codex if setup changed

Do not use the legacy bootstrap flow.
