# Tech Debt Audit (2026-03-19)

Method: `tech-debt` skill scoring.

Formula: `Priority = (Impact + Risk) x (6 - Effort)`.

## Prioritized Backlog

| # | Category | Item | Evidence | Impact | Risk | Effort | Priority |
|---|---|---|---|---:|---:|---:|---:|
| 1 | Infrastructure debt | Missing CI gate for test/build on push | No `.github/workflows` in repo | 5 | 4 | 2 | 36 |
| 2 | Code debt | Router cooldown duration is fixed 1 hour, while mirror layer uses adaptive backoff | `src/router/run_with_codex_pool.ts` `applyCooldown` | 4 | 4 | 3 | 24 |
| 3 | Dependency debt | Major-version drift in core deps (`zod`, `vitest`, `commander`, `@types/node`) | `pnpm outdated` output (2026-03-19) | 3 | 4 | 3 | 21 |
| 4 | Test debt | `run` command lacks real-process integration test for pool-exhausted fallback path (currently mock-driven) | `test/cli/run.test.ts` uses mocked executor only | 3 | 3 | 3 | 18 |
| 5 | Documentation debt | Operator runbook for account lifecycle actions is still sparse (enable/disable/cooldown clear/playbook) | README has basic commands only | 3 | 2 | 2 | 15 |

## Business Justification

- #1 prevents broken code from landing on `main`, reducing production incident probability and recovery time.
- #2 aligns operator-visible state with runtime behavior, reducing confusion during throttling incidents.
- #3 keeps upgrade cost bounded and reduces security/compatibility surprise during future feature work.
- #4 raises confidence that fallback behavior works against real OpenClaw process boundaries.
- #5 shortens on-call diagnosis time and lowers operational dependency on maintainers' tacit knowledge.

## Phased Remediation Plan

### Phase 1 (this week)

- Add CI workflow: run `pnpm install --frozen-lockfile`, `pnpm test`, `pnpm build`.
- Add status/incident runbook section in README for cooldown/disable/fallback triage.

### Phase 2 (next 1-2 weeks)

- Unify cooldown policy logic between router state and OpenClaw mirror (single source utility).
- Add one integration-style test that executes `run` command with a real child process harness.

### Phase 3 (next sprint)

- Upgrade dependencies incrementally:
  - `commander` and `@types/node` first.
  - `vitest` second with test harness compatibility checks.
  - `zod` major migration last (schema API compatibility pass).

## Execution Update (2026-03-19)

- ✅ #1 Infrastructure debt: CI workflow added at `.github/workflows/ci.yml` (push/PR runs install/test/build).
- ✅ #2 Code debt: router cooldown now mirrors OpenClaw usage cooldown timestamp instead of fixed 1 hour.
- ✅ #3 Dependency debt: `commander`, `@types/node`, `vitest`, and `zod` upgrades completed with full test/build verification.
- ✅ #4 Test debt: added real-process integration test `test/cli/run.integration.test.ts` with child-process harness.
- ✅ #5 Documentation debt: README now includes operator runbook and triage guidance.
