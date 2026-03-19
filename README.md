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

## Notes

- Default router state path: `config/accounts.json`
- Default OpenClaw auth store path: `~/.openclaw/agents/main/agent/auth-profiles.json`
- Binding `openai-codex:default` requires `--force-default`
