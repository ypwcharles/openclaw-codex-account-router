# OpenClaw Codex Account Router

External router for OpenClaw that prioritizes the `openai-codex` account pool and only allows cross-provider fallback after Codex accounts are exhausted.

## What it does

- Routes requests across multiple Codex accounts by priority.
- Classifies runtime failures (`rate_limit`, `auth_permanent`, `billing`, `timeout`, `unknown`).
- Mirrors cooldown/disable state into OpenClaw `auth-profiles.json`.
- When Codex pool is exhausted, runs one fallback attempt so OpenClaw can continue its provider fallback chain (for example MiniMax).

## Prerequisites

- Node.js 20+ (CI uses Node 22).
- `pnpm`.
- `openclaw` available in `PATH`.
- OpenClaw auth store exists: `~/.openclaw/agents/main/agent/auth-profiles.json`.

## Install

```bash
pnpm install
pnpm build
```

## CLI entrypoint

All commands below use:

```bash
node --import tsx src/cli/main.ts
```

## Use with OpenClaw

### 1. Bind Codex profiles into router state

List Codex profile IDs from OpenClaw auth store:

```bash
jq -r '.profiles | keys[] | select(startswith("openai-codex:"))' ~/.openclaw/agents/main/agent/auth-profiles.json
```

Bind each profile to an alias:

```bash
node --import tsx src/cli/main.ts accounts bind --alias acct-a --profile-id openai-codex:user-a@example.com
node --import tsx src/cli/main.ts accounts bind --alias acct-b --profile-id openai-codex:user-b@example.com
```

If you must bind `openai-codex:default`, you must add `--force-default`:

```bash
node --import tsx src/cli/main.ts accounts bind --alias acct-default --profile-id openai-codex:default --force-default
```

### 2. Verify wiring before traffic

```bash
node --import tsx src/cli/main.ts doctor --json
node --import tsx src/cli/main.ts status --json
```

Expect:

- `doctor.ok=true`
- `status.activeAccounts` non-empty

### 3. Run OpenClaw through the router

Example:

```bash
node --import tsx src/cli/main.ts run -- openclaw agent --message "hello"
```

JSON mode:

```bash
node --import tsx src/cli/main.ts run --json -- openclaw agent --message "hello"
```

Useful fields:

- `usedProfileIds`: Codex profiles attempted in order.
- `poolExhausted=true`: Codex pool was exhausted before final fallback attempt.
- `result`: present when final run succeeded (either within Codex pool or via fallback).
- `lastError`: present when final run failed.

### 4. Optional shell alias

If you want to keep the same OpenClaw usage style, add a shell alias:

```bash
alias openclaw-router='node --import tsx /ABSOLUTE/PATH/openclaw-codex-account-router/src/cli/main.ts run -- openclaw'
```

Then run:

```bash
openclaw-router agent --message "hello"
```

## Account operations

```bash
# list current accounts and order
node --import tsx src/cli/main.ts accounts list

# enable / disable
node --import tsx src/cli/main.ts accounts enable acct-a
node --import tsx src/cli/main.ts accounts disable acct-a

# reorder by alias
node --import tsx src/cli/main.ts accounts order set acct-b acct-a

# clear cooldown marker for one alias
node --import tsx src/cli/main.ts cooldown clear acct-a
```

## Incident triage

```bash
# inspect current router state
node --import tsx src/cli/main.ts status --json

# validate binary/auth-store/mapping
node --import tsx src/cli/main.ts doctor --json

# reproduce via router run path
node --import tsx src/cli/main.ts run --json -- openclaw agent --message "ping"
```

Interpretation:

- `status.cooldowns` shows only active cooldowns (expired entries are hidden).
- `doctor.alias_profile_mapping` must be `ok=true`; if false, fix profile binding drift first.
- `poolExhausted=true` means Codex pool is unavailable and router proceeded with fallback attempt.

## Paths and defaults

- Router state default path: `config/accounts.json`.
- OpenClaw auth store default path: `~/.openclaw/agents/main/agent/auth-profiles.json`.
- Override with `--router-state` and `--auth-store`.

## Development

```bash
pnpm test
pnpm build
```

CI runs the same checks on push/PR.
