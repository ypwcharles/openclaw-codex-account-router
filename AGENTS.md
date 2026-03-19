# AGENTS.md

If you are an agent operating inside this repository, read this first.

## Mission

This project is a local OpenClaw router for `openai-codex` multi-account failover.

Required behavior:

- Keep traffic inside the Codex account pool first.
- Mirror router decisions into OpenClaw auth state.
- Allow cross-provider fallback only after the Codex pool is exhausted.

## Fast mental model

```text
router state -> select Codex account -> sync OpenClaw order
            -> run openclaw -> classify failure
            -> cooldown / disable / retry
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
- CLI contract
  - `src/cli/main.ts`
  - `src/cli/commands/accounts.ts`
  - `src/cli/commands/status.ts`
  - `src/cli/commands/doctor.ts`
  - `src/cli/commands/run.ts`

## Behavioral invariants

Do not break these:

- `openai-codex:default` binding requires explicit `--force-default`.
- `accounts enable` must make an account routable again.
- `cooldown clear` must only clear cooldown semantics, not disabled semantics.
- Router cooldown timestamps should match OpenClaw mirrored cooldown timestamps.
- `run` must do one final fallback execution after pool exhaustion.
- `status.cooldowns` should show only active cooldown entries.

## Command surface

The public CLI is:

- `status [--router-state <path>] [--json]`
- `doctor [--router-state <path>] [--auth-store <path>] [--json]`
- `run [--router-state <path>] [--auth-store <path>] [--json] [commandArgs...]`
- `accounts bind --alias <alias> --profile-id <id> [--priority <n>] [--force-default]`
- `accounts list`
- `accounts enable <alias>`
- `accounts disable <alias>`
- `accounts order set <aliases...>`
- `cooldown clear <alias>`

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

## Validation gate

Before claiming completion:

```bash
pnpm test
pnpm build
```

If command behavior changed, also run one representative CLI command manually.

## Scope discipline

- Do not add a network admin API for this project.
- Do not change unrelated OpenClaw provider behavior.
- Prefer small, explicit edits over broad refactors.
- Keep OpenClaw-facing constants and semantics easy to patch when upstream changes.

## Environment assumptions

- Router state default path: `config/accounts.json`
- OpenClaw auth store default path: `~/.openclaw/agents/main/agent/auth-profiles.json`
- `openclaw` is expected in `PATH`

## Superpowers

This repo expects Superpowers via native skill discovery:

1. Clone to `~/.codex/superpowers`
2. Symlink `~/.agents/skills/superpowers` -> `~/.codex/superpowers/skills`
3. Restart Codex if setup changed

Do not use the legacy bootstrap flow.
