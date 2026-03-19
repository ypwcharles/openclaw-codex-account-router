# AGENTS.md

## Project intent

This repository provides a local router CLI for OpenClaw:

- Keep traffic in `openai-codex` account pool first.
- Mirror account health to OpenClaw auth store.
- Allow provider fallback only after Codex pool exhaustion.

## Superpowers setup

This repo expects Superpowers to be installed via native skill discovery:

1. Clone to `~/.codex/superpowers`
2. Symlink `~/.agents/skills/superpowers` -> `~/.codex/superpowers/skills`
3. Restart Codex if setup changed

Do not use legacy bootstrap flow.

## Core commands

- Install: `pnpm install`
- Test: `pnpm test`
- Build: `pnpm build`
- CLI help: `node --import tsx src/cli/main.ts --help`

## Router command surface

- `status [--router-state <path>] [--json]`
- `doctor [--router-state <path>] [--auth-store <path>] [--json]`
- `run [--router-state <path>] [--auth-store <path>] [--json] [commandArgs...]`
- `accounts bind --alias <alias> --profile-id <id> [--priority <n>] [--force-default]`
- `accounts list`
- `accounts enable <alias>`
- `accounts disable <alias>`
- `accounts order set <aliases...>`
- `cooldown clear <alias>`

## Behavioral invariants

- `openai-codex:default` binding requires explicit `--force-default`.
- `accounts enable` must produce a routable account (`enabled=true`, not stuck disabled).
- `cooldown clear` must only clear cooldown semantics and must not silently clear disabled markers.
- Runtime cooldown timestamps in router state should stay aligned with OpenClaw mirrored cooldown.
- On pool exhausted, `run` performs one fallback execution attempt.

## Files to treat as source of truth

- Router state schema/store:
  - `src/account_store/schema.ts`
  - `src/account_store/store.ts`
  - `src/account_store/bind.ts`
- OpenClaw mirror bridge:
  - `src/router/openclaw_auth_store.ts`
  - `src/router/openclaw_usage_mirror.ts`
  - `src/router/run_with_codex_pool.ts`
- CLI contract:
  - `src/cli/main.ts`
  - `src/cli/commands/*.ts`

## Test strategy requirements

- Prefer TDD for behavior changes:
  1. add/adjust failing test
  2. implement minimal fix
  3. run targeted tests
  4. run full `pnpm test`
- For CLI runtime behavior changes, include at least one integration-style test with real child process execution.
- Keep acceptance behavior covered in `test/acceptance/requirements.test.ts`.

## Completion gate

Before claiming work complete:

1. `pnpm test`
2. `pnpm build`
3. If CLI behavior changed, validate one representative command manually.

## Scope discipline

- Avoid introducing network services or HTTP admin APIs for MVP.
- Keep OpenClaw compatibility stable; do not change unrelated provider behavior.
- Prefer small, explicit changes over broad refactors.
