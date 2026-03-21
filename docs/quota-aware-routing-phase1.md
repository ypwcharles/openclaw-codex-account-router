# Quota-Aware Routing Phase 1

## Goal

Upgrade the router from pure error-driven cooldown heuristics to quota-aware failover using the same Codex usage data surfaced by ChatGPT / Codex clients.

This phase keeps the existing CLI contract and cooldown-based routing invariants intact while adding a better source of truth for rate-limit reset timing.

## Problem

Current behavior treats `cooldownUntil` as the single bucket for:

- transport retry/backoff
- rate-limit recovery
- pool exhaustion signaling

That causes two issues:

1. **Bad reset accuracy** — router cooldowns are guessed from local heuristics instead of real `reset_at` data.
2. **Poor observability** — `status` can only show cooldown/disabled state, not the underlying 5h / weekly quota windows.

## Constraints

We must preserve these repo invariants in Phase 1:

- `run` still performs one final provider fallback after Codex pool exhaustion.
- `status.cooldowns` still reflects active unroutable accounts.
- Router cooldown timestamps must still match mirrored OpenClaw cooldown timestamps.
- Existing account store schema and command surface should not require a migration.

## Design

### 1. Introduce quota snapshots in mirrored OpenClaw usage state

Extend mirrored `usageStats[profileId]` with an optional quota snapshot:

```ts
{
  quotaSource?: "usage_api";
  quotaFetchedAt?: number;
  planType?: string;
  limitReached?: boolean;
  primaryUsedPercent?: number;
  primaryRemainingPercent?: number;
  primaryWindowMinutes?: number;
  primaryResetAt?: number;
  secondaryUsedPercent?: number;
  secondaryRemainingPercent?: number;
  secondaryWindowMinutes?: number;
  secondaryResetAt?: number;
}
```

This keeps quota data next to the existing OpenClaw mirror without changing router-state schema.

### 2. Fetch Codex usage from `wham/usage`

For the currently failing Codex profile, call:

- `GET https://chatgpt.com/backend-api/wham/usage`
- `Authorization: Bearer <access token>`
- `ChatGPT-Account-Id: <account id>` when available

Inputs are read from the OpenClaw auth profile (`profiles[profileId]`).

### 3. Normalize reset timing

When the usage response includes quota windows:

- prefer `reset_at`
- otherwise derive reset from `now + reset_after_seconds`

This produces a durable quota snapshot and an optional **quota-derived cooldown deadline**.

### 4. Preserve cooldown compatibility in Phase 1

Long-term, quota state and transport backoff should be separate.

Phase 1 intentionally does **not** split the selection engine yet. Instead:

- keep storing quota snapshot as structured data
- when a rate-limit failure happens, if quota snapshot yields a future reset time, mirror that reset time into both:
  - OpenClaw `usageStats[profileId].cooldownUntil`
  - router `account.cooldownUntil`

This keeps existing selection logic unchanged while replacing guessed cooldowns with server-derived reset times.

### 5. Expose quota data in `status`

`status --json` should now surface per-account quota details so callers can distinguish:

- cooldown semantics
- 5h window
- weekly window
- source freshness

## Scope of this phase

### Included

- Codex usage API parser + fetcher
- quota snapshot persistence into mirrored OpenClaw auth state
- rate-limit flow uses quota-derived reset times when available
- `status --json` exposes quota snapshot fields
- tests for parser, rate-limit mirroring, and status payload

### Deferred to Phase 2

- separate `retryUntil` vs `quotaResetAt` state machine
- stale snapshot refresh before every candidate selection
- score-based selector instead of pure priority ordering
- background proactive quota refresh

## Expected outcome

After this phase:

- rate-limit cooldowns are driven by real Codex usage reset data when available
- status output can explain *why* an account is cooling down
- existing CLI behavior and fallback semantics stay stable

## Validation

Required validation gate:

```bash
pnpm test
pnpm build
```
