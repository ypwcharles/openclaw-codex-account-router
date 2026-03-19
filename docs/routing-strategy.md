# Routing Strategy

## Priority Rule

The router always prefers `openai-codex` account rotation over cross-provider fallback:

1. Try eligible Codex account by priority.
2. On `rate_limit`, put account in cooldown and try next Codex account.
3. On `auth_permanent` or `billing`, disable account and try next Codex account.
4. On `timeout`, retry once on same account, then cooldown and move on.
5. If all Codex accounts are unavailable, mark pool as exhausted and allow provider fallback (for example MiniMax).

## State Sources

- Router state: `config/accounts.json` (or explicit `--router-state`)
- OpenClaw auth store: `~/.openclaw/agents/main/agent/auth-profiles.json` (or explicit `--auth-store`)

The router mirrors order and failure status into OpenClaw auth store to reuse native profile rotation behavior.

## Operational Commands

- `codex-account-router accounts bind --alias <alias> --profile-id <profile>`
- `codex-account-router accounts list`
- `codex-account-router accounts enable <alias>`
- `codex-account-router accounts disable <alias>`
- `codex-account-router accounts order set <aliases...>`
- `codex-account-router cooldown clear <alias>`
- `codex-account-router status --json`
- `codex-account-router doctor --json`
- `codex-account-router run -- openclaw agent --message "..."`
