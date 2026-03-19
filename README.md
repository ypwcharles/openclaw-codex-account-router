# OpenClaw Codex Account Router

External router/wrapper for `openai-codex` multi-account failover.

## What it does

- Keeps runs in Codex account pool first.
- Mirrors cooldown/disable state into OpenClaw `auth-profiles.json`.
- Falls through to provider fallback only after Codex pool is exhausted.

## Setup

```bash
pnpm install
pnpm build
```

## Basic usage

```bash
node --import tsx src/cli/main.ts accounts bind --alias acct-a --profile-id openai-codex:user@example.com
node --import tsx src/cli/main.ts accounts list
node --import tsx src/cli/main.ts status --json
node --import tsx src/cli/main.ts doctor --json
node --import tsx src/cli/main.ts run -- openclaw agent --message "hello"
```

## Operator runbook

### Account lifecycle

```bash
# list current accounts and order
node --import tsx src/cli/main.ts accounts list

# disable/enable one alias
node --import tsx src/cli/main.ts accounts disable acct-a
node --import tsx src/cli/main.ts accounts enable acct-a

# reorder explicit priority
node --import tsx src/cli/main.ts accounts order set acct-b acct-a

# clear cooldown for one alias
node --import tsx src/cli/main.ts cooldown clear acct-a
```

### Incident triage

```bash
# 1) inspect router state
node --import tsx src/cli/main.ts status --json

# 2) verify wiring and auth-store mapping
node --import tsx src/cli/main.ts doctor --json

# 3) run command through router
node --import tsx src/cli/main.ts run --json -- openclaw agent --message "ping"
```

Triage interpretation:
- `poolExhausted=true` means Codex pool is unavailable and the final run was allowed to provider fallback.
- `status.cooldowns` shows only active cooldown entries (expired cooldowns are omitted).
- `doctor.alias_profile_mapping` must be `ok=true`; otherwise fix alias/profile drift before retrying traffic.

## Notes

- Default router state path: `config/accounts.json`
- Default OpenClaw auth store path: `~/.openclaw/agents/main/agent/auth-profiles.json`
- Binding `openai-codex:default` requires `--force-default`
