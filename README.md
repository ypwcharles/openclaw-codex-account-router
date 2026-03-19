# OpenClaw Router

`openclaw-router` keeps traffic inside your `openai-codex` account pool first, mirrors account health into OpenClaw auth state, and only allows cross-provider fallback after the Codex pool is exhausted.

## What changed

This project now supports an install/repair model:

- `openclaw-router setup` installs managed artifacts under `~/.openclaw-router`
- `setup` also snapshots OpenClaw auth store before router mutation
- a managed `openclaw` shim forwards plain `openclaw ...` calls into router logic
- `openclaw-router repair` rebuilds missing/corrupted shim + service files from persisted integration state
- `openclaw-router restore` restores OpenClaw auth store from the setup snapshot

Routing semantics remain unchanged:

- Codex accounts are tried by priority
- failures are classified and mirrored back to OpenClaw `usageStats`
- one final fallback execution is allowed after Codex pool exhaustion

## Prerequisites

- Node.js 20+
- `pnpm`
- OpenClaw auth store with `openai-codex:*` profiles

Default state locations:

- router state: `~/.openclaw-router/router-state.json` (after setup)
- integration state: `~/.openclaw-router/integration.json`
- OpenClaw auth store: `~/.openclaw/agents/main/agent/auth-profiles.json`

## Quick start

Install dependencies and build:

```bash
pnpm install
pnpm build
```

Run setup:

```bash
node --import tsx src/cli/main.ts setup --json
```

Check health:

```bash
node --import tsx src/cli/main.ts doctor --json
node --import tsx src/cli/main.ts status --json
```

`status` / `doctor` / `run` auto-discover `~/.openclaw-router/integration.json` when `HOME` is available.
In CI or minimal envs without `HOME`, pass explicit `--integration-state` (or explicit `--router-state` and `--auth-store` for `run`/`doctor`).

## Daily usage

### 1) Plain `openclaw` through shim

After setup, add managed bin path ahead of your normal OpenClaw path:

```bash
export PATH="$HOME/.openclaw-router/bin:$PATH"
openclaw agent --message "hello"
```

### 2) Run explicitly via router command

```bash
node --import tsx src/cli/main.ts run --integration-state ~/.openclaw-router/integration.json -- openclaw agent
```

## Commands

Top-level user commands:

```bash
openclaw-router setup [--home-dir <path>] [--platform darwin|linux] [--auth-store <path>] [--router-state <path>] [--integration-state <path>] [--json]
openclaw-router status [--router-state <path>] [--integration-state <path>] [--json]
openclaw-router doctor [--router-state <path>] [--auth-store <path>] [--integration-state <path>] [--json]
openclaw-router run [--router-state <path>] [--auth-store <path>] [--integration-state <path>] [--json] [commandArgs...]
openclaw-router repair [--integration-state <path>] [--json]
openclaw-router restore [--integration-state <path>] [--auth-store <path>] [--json]
openclaw-router account list
openclaw-router account add --profile-id <id> [--alias <alias>] [--priority <n>] [--force-default]
openclaw-router account enable <alias>
openclaw-router account disable <alias>
openclaw-router account order <aliases...>
```

Compatibility commands are still available:

- `accounts bind/list/enable/disable/order set`
- `cooldown clear`

## Repair

If shim/service artifacts drift or are deleted:

```bash
openclaw-router repair --integration-state ~/.openclaw-router/integration.json
```

Repair regenerates:

- managed `openclaw` shim
- platform service definition file

## Restore

If you need to revert OpenClaw auth store to setup-time baseline:

```bash
openclaw-router restore --integration-state ~/.openclaw-router/integration.json
```

By default, setup snapshot is written to:

- `~/.openclaw-router/backups/auth-profiles.pre-router.json`

## Uninstall / rollback

1. Remove managed bin from your shell `PATH`.
2. Delete managed install root:

```bash
rm -rf ~/.openclaw-router
```

3. If you manually loaded a launchd/systemd unit from the managed service definition, unload/disable it.

This rollback is reversible; rerun `openclaw-router setup` to reinstall artifacts.

## macOS / Linux notes

- macOS service definition is rendered as a `launchd` plist.
- Linux service definition is rendered as a `systemd --user` unit.
- If PATH precedence is wrong, `doctor` reports the exact correction needed.

## Development

```bash
pnpm test
pnpm build
```

Representative command checks:

```bash
node --import tsx src/cli/main.ts --help
node --import tsx src/cli/main.ts setup --help
node --import tsx src/cli/main.ts account --help
```
