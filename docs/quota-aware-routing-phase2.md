# Quota-Aware Routing Phase 2

## Goal

Split the router's current overloaded `cooldownUntil` concept into **two independent control planes**:

1. **Transport retry / backoff state** — short-lived, local, heuristic, used for timeouts/network flakiness
2. **Quota exhaustion state** — server-derived, longer-lived, based on usage snapshots (`reset_at` / `reset_after_seconds`)

Phase 1 improved reset accuracy by reusing `cooldownUntil` as a compatibility bridge.
Phase 2 removes that compromise and makes routing decisions explainable and extensible.

---

## Why Phase 1 is not enough

Phase 1 deliberately kept selection semantics unchanged. That was correct for safety, but it means the router still has one bucket doing too many jobs.

Current problems:

- a timeout backoff and a true 5h quota reset both appear as `cooldown`
- selection cannot explain whether an account is blocked by transport instability or quota exhaustion
- stale quota snapshots may keep an account blocked longer than necessary
- status surfaces show quota detail, but the selector still thinks in legacy cooldown terms

In short:

**observability improved, state semantics did not.**

---

## Design principles

### 1. Separate truth from compatibility

The selector should operate on semantically correct fields.
Compatibility fields may still exist temporarily for older consumers, but they should no longer be the source of truth.

### 2. Prefer server truth over heuristics

If usage API says reset is at `T`, quota gating should use `T`.
Local heuristics are only for transport instability or API-unavailable fallback.

### 3. Freshness matters

A quota snapshot is only useful while reasonably fresh.
Selection must treat staleness explicitly instead of pretending old data is current truth.

### 4. Routing should be explainable

For every rejected account, the router should be able to answer:

- disabled by auth/billing?
- backoff due to transient transport failures?
- quota exhausted in primary window?
- quota exhausted in secondary window?
- quota snapshot stale and refresh failed?

---

## State model

### Current state (Phase 1)

```ts
usageStats[profileId] = {
  cooldownUntil?: number,
  disabledUntil?: number,
  disabledReason?: string,
  errorCount?: number,
  failureCounts?: Record<string, number>,
  lastFailureAt?: number,
  quotaSource?: "usage_api",
  quotaFetchedAt?: number,
  planType?: string,
  limitReached?: boolean,
  primaryUsedPercent?: number,
  primaryRemainingPercent?: number,
  primaryWindowMinutes?: number,
  primaryResetAt?: number,
  secondaryUsedPercent?: number,
  secondaryRemainingPercent?: number,
  secondaryWindowMinutes?: number,
  secondaryResetAt?: number
}
```

### Proposed Phase 2 state

```ts
usageStats[profileId] = {
  lastUsed?: number,

  // Hard disable lane
  disabledUntil?: number,
  disabledReason?: "auth_permanent" | "billing",

  // Transport lane
  retryUntil?: number,
  retryReason?: "timeout" | "network" | "unknown",
  retryCount?: number,

  // Failure history
  errorCount?: number,
  failureCounts?: Record<string, number>,
  lastFailureAt?: number,

  // Quota lane
  quota?: {
    source?: "usage_api",
    fetchedAt?: number,
    staleAfter?: number,
    refreshFailedAt?: number,
    refreshErrorCode?: string,
    planType?: string,
    limitReached?: boolean,
    primary?: {
      usedPercent?: number,
      remainingPercent?: number,
      windowMinutes?: number,
      resetAt?: number
    },
    secondary?: {
      usedPercent?: number,
      remainingPercent?: number,
      windowMinutes?: number,
      resetAt?: number
    }
  },

  // Temporary compatibility only
  cooldownUntil?: number
}
```

### Interpretation

- `disabledUntil` = hard exclusion
- `retryUntil` = temporary transport exclusion
- `quota.primary.resetAt` / `quota.secondary.resetAt` = server-derived quota exclusion windows
- `cooldownUntil` = transitional mirror for old CLI / integrations only; not used as selector truth once Phase 2 lands

---

## Derived runtime model

The selector should derive a **runtime account state** from persisted fields instead of reading raw fields ad hoc.

```ts
type RuntimeAccountState = {
  alias: string;
  profileId: string;
  selectable: boolean;
  hardBlocked: boolean;
  blockReason:
    | "disabled"
    | "transport_backoff"
    | "primary_quota_exhausted"
    | "secondary_quota_exhausted"
    | "quota_snapshot_stale"
    | "none";
  retryUntil?: number;
  quotaResetAt?: number;
  quotaSnapshotStale: boolean;
  score: number;
}
```

This keeps selection logic deterministic and testable.

---

## Staleness policy

### Default rule

A usage snapshot is **stale after 15 minutes**.

Reason:

- much shorter than 5h/weekly windows
- cheap enough to revalidate on demand
- long enough to avoid hammering the API during rapid local retries

### Behavior

#### Fresh snapshot
Use it directly.

#### Stale snapshot + refresh succeeds
Replace old snapshot and re-run eligibility.

#### Stale snapshot + refresh fails
Do **not** permanently block the account.
Instead:

- if old snapshot shows quota exhausted and resetAt is still in the future, keep respecting it for one grace period
- otherwise fall back to optimistic routing with a small transport retry guard

This avoids the worst failure mode: stale data blackholing a good account forever.

---

## Candidate selection algorithm

## Step 1 — filter hard-disabled accounts

Exclude accounts where:

- `enabled === false`
- configured router status is disabled
- `disabledUntil > now`

## Step 2 — evaluate transport backoff

If `retryUntil > now`, mark as `transport_backoff` and exclude temporarily.

## Step 3 — evaluate quota state

Given a fresh or refreshed quota snapshot:

- if `primary.remainingPercent <= 0` and `primary.resetAt > now`, mark `primary_quota_exhausted`
- else if `secondary.remainingPercent <= 0` and `secondary.resetAt > now`, mark `secondary_quota_exhausted`
- else quota does not block selection

## Step 4 — handle stale quota

If snapshot stale:

1. attempt refresh for that account before final exclusion
2. if refresh unavailable, mark `quota_snapshot_stale`
3. apply fallback policy (see Staleness policy)

## Step 5 — score remaining candidates

Priority should no longer be the only sort key.
Recommended score components:

```text
score =
  priorityWeight
  + freshnessWeight
  + remainingQuotaWeight
  - recentFailurePenalty
  - recentUsagePenalty
```

Suggested ordering intent:

1. healthy + fresh quota data
2. more remaining primary quota
3. less recently used account
4. lower recent failure pressure
5. configured priority as tiebreaker or base weight

This is how we stop burning one account just because it sits first forever.

---

## Write-path changes

### On timeout/network failure

- increment failure counters
- update `retryUntil`
- do **not** touch quota reset fields
- do not pretend this is a quota cooldown

### On rate-limit failure

- fetch usage API immediately
- write/update `quota` snapshot
- derive quota exhaustion from server windows
- set compatibility `cooldownUntil` = earliest active quota reset only during migration period

### On success

- clear `retryUntil`
- keep quota snapshot, but do not clear it unless explicitly invalid
- update `lastUsed`

### On auth/billing failure

- set `disabledUntil`
- clear `retryUntil`
- keep quota snapshot only as historical telemetry

---

## Status / CLI surface changes

Phase 2 should expose both **effective state** and **why**.

### Proposed `status --json` additions

```ts
{
  effectiveStatus: "healthy" | "cooldown" | "disabled",
  blockReason?: "transport_backoff" | "primary_quota_exhausted" | "secondary_quota_exhausted" | "disabled",
  retryUntil?: string,
  quota?: {
    stale: boolean,
    fetchedAt?: string,
    staleAfter?: string,
    primary?: { ... },
    secondary?: { ... }
  }
}
```

Important distinction:

- `effectiveStatus` is for backward compatibility / human summary
- `blockReason` is the real selector explanation

Without `blockReason`, status remains too mushy.

---

## Migration strategy

### Phase 2a

- keep old flat quota fields readable
- start writing nested `quota` object and `retryUntil`
- derive `cooldownUntil` only as compatibility shadow
- selector prefers new fields when present

### Phase 2b

- stop using `cooldownUntil` for routing decisions
- continue emitting it temporarily for status/backward compatibility

### Phase 2c

- remove legacy dependence on flat quota fields
- optionally migrate flat fields into nested structure

This staged migration avoids breaking old tooling while letting the selector become semantically correct.

---

## Test plan

### Unit tests

1. runtime-state derivation
   - timeout backoff only
   - primary quota exhausted only
   - secondary quota exhausted only
   - disabled + quota present
   - stale snapshot with no refresh

2. selector scoring
   - two healthy accounts with different remaining quota
   - two healthy accounts with same quota but different recent use
   - stale-vs-fresh tie-breaking

3. write paths
   - timeout updates `retryUntil` but not quota reset
   - rate limit updates quota snapshot and compatibility cooldown
   - success clears retry lane only

### Integration tests

1. stale snapshot refresh before selection
2. refresh failure fallback behavior
3. status JSON shows `blockReason` and `retryUntil`
4. pool exhaustion still allows one final provider fallback

---

## Risks

### Risk 1 — over-refreshing usage API

If we refresh on every candidate check, we may add unnecessary latency or hit upstream controls.

**Mitigation:** only refresh stale snapshots and serialize refreshes per account.

### Risk 2 — stale data blocks healthy accounts

If we trust old quota snapshots too much, routing becomes pessimistic.

**Mitigation:** explicit staleness handling + grace policy + optimistic fallback when refresh fails.

### Risk 3 — compatibility drift

If `cooldownUntil` and new state diverge, operators get confused.

**Mitigation:** Phase 2 keeps `cooldownUntil` as a deterministic derived shadow, not an independently written field.

### Risk 4 — scoring becomes too clever

A fancy selector can become hard to debug.

**Mitigation:** keep scoring transparent and expose `blockReason` + selected score inputs in debug/status output.

---

## Recommended implementation order

1. Introduce `retryUntil` and nested `quota` shape in mirror state
2. Add runtime-state derivation helper
3. Refactor selector to use runtime-state helper
4. Add stale snapshot refresh-before-exclude
5. Add `blockReason` / `retryUntil` to status JSON
6. Keep compatibility `cooldownUntil` shadow until old consumers are retired

---

## Bottom line

Phase 1 made quota routing **more accurate**.
Phase 2 should make it **semantically correct**.

If Phase 1 was “stop lying about reset time”,
then Phase 2 is “stop pretending every temporary exclusion is the same thing”.
