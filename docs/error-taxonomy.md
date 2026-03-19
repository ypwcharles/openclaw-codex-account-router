# Error Taxonomy

This table defines Codex-specific error normalization for the router.

| Source pattern | Normalized reason | Router action | OpenClaw mirror target |
| --- | --- | --- | --- |
| `You have hit your ChatGPT usage limit...`, `429`, `Retry-After`, `insufficient_quota` | `rate_limit` | `cooldown` | `usageStats.<profile>.cooldownUntil` |
| `{"detail":{"code":"deactivated_workspace"}}` | `auth_permanent` | `disable` | `usageStats.<profile>.disabledUntil`, `disabledReason=auth_permanent` |
| `invalid_grant`, `auth revoked`, `workspace disabled` | `auth_permanent` | `disable` | `usageStats.<profile>.disabledUntil`, `disabledReason=auth_permanent` |
| `insufficient credits`, `payment required`, billing hard limit | `billing` | `disable` | `usageStats.<profile>.disabledUntil`, `disabledReason=billing` |
| `timeout`, `timed out`, `ECONNRESET` | `timeout` | `retry` (then cooldown if repeated) | none on first retry |
| no match | `unknown` | `retry` | none |
