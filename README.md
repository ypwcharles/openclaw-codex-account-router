# OpenClaw Codex Account Router

Keep OpenClaw traffic inside your `openai-codex` account pool first. Only let OpenClaw fall through to cross-provider fallback after every Codex account is cooling down or disabled.

## At a glance

- Works as a local wrapper around `openclaw`.
- Stores router-owned state in `config/accounts.json`.
- Mirrors runtime health into OpenClaw `auth-profiles.json`.
- Retries across multiple Codex accounts by priority.
- Allows one final fallback run when the Codex pool is exhausted.

## Why this exists

OpenClaw already knows how to rotate auth profiles and fall back across providers. What it does not know, by default, is how to treat Codex-specific failures as part of a managed multi-account pool.

This project fills that gap:

- `rate_limit` keeps traffic inside the Codex pool.
- `auth_permanent` and `billing` disable the broken account.
- `timeout` retries once, then cools down the account.
- Only after the Codex pool is exhausted does the wrapper allow OpenClaw to continue its normal provider fallback chain.

## How it works

```text
You -> codex-account-router run -> select Codex account by priority
   -> sync OpenClaw order["openai-codex"]
   -> run openclaw
      -> success: stop
      -> failure: classify and mirror state
         -> next Codex account
            -> pool exhausted: run one final fallback attempt
```

State sources:

- Router state: `config/accounts.json`
- OpenClaw auth store: `~/.openclaw/agents/main/agent/auth-profiles.json`

## Quick start

### Prerequisites

- Node.js 20+
- `pnpm`
- `openclaw` available in `PATH`
- Existing OpenClaw auth store with Codex profiles

### Install

```bash
pnpm install
pnpm build
```

### Discover Codex profile IDs from OpenClaw

```bash
jq -r '.profiles | keys[] | select(startswith("openai-codex:"))' ~/.openclaw/agents/main/agent/auth-profiles.json
```

### Bind accounts into router state

```bash
node --import tsx src/cli/main.ts accounts bind --alias acct-a --profile-id openai-codex:user-a@example.com
node --import tsx src/cli/main.ts accounts bind --alias acct-b --profile-id openai-codex:user-b@example.com
```

If you need to bind `openai-codex:default`, it must be explicit:

```bash
node --import tsx src/cli/main.ts accounts bind --alias acct-default --profile-id openai-codex:default --force-default
```

### Verify wiring

```bash
node --import tsx src/cli/main.ts doctor --json
node --import tsx src/cli/main.ts status --json
```

Healthy baseline:

- `doctor.ok = true`
- `status.activeAccounts` is non-empty

### Run OpenClaw through the router

```bash
node --import tsx src/cli/main.ts run -- openclaw agent --message "hello"
```

JSON mode:

```bash
node --import tsx src/cli/main.ts run --json -- openclaw agent --message "hello"
```

## Using this with OpenClaw

The intended usage is simple: instead of calling `openclaw` directly for Codex-heavy traffic, call the router first.

### Option 1: call the router explicitly

```bash
node --import tsx /ABSOLUTE/PATH/openclaw-codex-account-router/src/cli/main.ts run -- openclaw agent --message "ping"
```

### Option 2: add a shell alias

```bash
alias openclaw-router='node --import tsx /ABSOLUTE/PATH/openclaw-codex-account-router/src/cli/main.ts run -- openclaw'
```

Then:

```bash
openclaw-router agent --message "ping"
```

### What OpenClaw sees

The router writes its decisions back into OpenClaw state:

- `order["openai-codex"]` is kept in sync with router priority.
- `usageStats[profileId].cooldownUntil` reflects active cooldowns.
- `usageStats[profileId].disabledUntil` and `disabledReason` reflect disabled accounts.

That means OpenClaw can keep doing the heavy lifting for auth profile rotation and eventual provider fallback.

## Command reference

### Status

```bash
node --import tsx src/cli/main.ts status [--router-state <path>] [--json]
```

Shows:

- ordered aliases
- eligible accounts
- active cooldowns
- next candidate
- last provider fallback reason

### Doctor

```bash
node --import tsx src/cli/main.ts doctor [--router-state <path>] [--auth-store <path>] [--json]
```

Checks:

- `openclaw` binary is available
- auth store is readable and writable
- every alias points to an existing OpenClaw profile
- `openai-codex:default` is not bound by multiple aliases

### Run

```bash
node --import tsx src/cli/main.ts run [--router-state <path>] [--auth-store <path>] [--json] -- openclaw ...
```

Key JSON fields:

- `usedProfileIds`: Codex profiles attempted in order
- `poolExhausted`: whether Codex pool ran out before final fallback run
- `result`: final successful execution result
- `lastError`: final failure message if no success

### Accounts

```bash
node --import tsx src/cli/main.ts accounts list
node --import tsx src/cli/main.ts accounts bind --alias acct-a --profile-id openai-codex:user@example.com
node --import tsx src/cli/main.ts accounts enable acct-a
node --import tsx src/cli/main.ts accounts disable acct-a
node --import tsx src/cli/main.ts accounts order set acct-b acct-a
node --import tsx src/cli/main.ts cooldown clear acct-a
```

## Operator runbook

### Common operations

```bash
# inspect current routing state
node --import tsx src/cli/main.ts status --json

# inspect account bindings
node --import tsx src/cli/main.ts accounts list

# disable a broken account
node --import tsx src/cli/main.ts accounts disable acct-a

# re-enable a recovered account
node --import tsx src/cli/main.ts accounts enable acct-a

# clear an active cooldown
node --import tsx src/cli/main.ts cooldown clear acct-a
```

### Triage guide

- `poolExhausted=true` means the router allowed a final fallback attempt outside the Codex pool.
- `status.cooldowns` shows only active cooldowns; expired entries are intentionally hidden.
- If `doctor.alias_profile_mapping` fails, fix profile drift before sending more traffic.
- If a single alias repeatedly disables itself, check whether the underlying OpenClaw profile is revoked, expired, or billing-blocked.

## Agent-facing notes

If you are an agent working in this repo:

- Start with [AGENTS.md](/Users/peiwenyang/Development/openclaw-codex-account-router/AGENTS.md)
- Router invariants live in:
  - `src/account_store/bind.ts`
  - `src/router/run_with_codex_pool.ts`
  - `src/router/openclaw_auth_store.ts`
- Acceptance behavior lives in:
  - `test/acceptance/requirements.test.ts`
- Real-process CLI fallback coverage lives in:
  - `test/cli/run.integration.test.ts`

## Development

```bash
pnpm test
pnpm build
```

CI runs the same checks on push and pull request.

## Defaults

- Default router state path: `config/accounts.json`
- Default OpenClaw auth store path: `~/.openclaw/agents/main/agent/auth-profiles.json`
