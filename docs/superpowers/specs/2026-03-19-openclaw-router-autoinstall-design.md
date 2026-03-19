# OpenClaw Router Autoinstall Design

## Goal

Turn `openclaw-codex-account-router` from a developer-oriented wrapper CLI into a user-facing `openclaw-router` command that:

- provides simple setup and account management,
- installs platform integration for macOS and Linux,
- becomes effectively invisible after initial configuration,
- keeps OpenClaw daily usage natural.

## Non-goals

- No HTTP admin API.
- No direct upstream patch to OpenClaw core.
- No deep binary replacement of the real `openclaw` executable.
- No Windows support in this phase.

## User experience

### First-time setup

The user runs:

```bash
openclaw-router setup
```

The setup flow should:

1. Detect platform (`darwin` or `linux`).
2. Detect the real `openclaw` binary.
3. Detect OpenClaw auth store.
4. Discover available `openai-codex:*` profile IDs from OpenClaw.
5. Create router state if missing.
6. Offer a simple alias mapping and default ordering.
7. Install integration artifacts:
   - a stable `openclaw-router` executable entrypoint,
   - an `openclaw` shim in a router-managed bin directory,
   - platform service metadata (`launchd` or `systemd --user`) for repairability,
   - environment/config files required by the shim.
8. Print concise “what changed” and “how to undo/repair”.

After this, the user should be able to keep using:

```bash
openclaw ...
```

without manually wrapping it.

### Day-2 operations

The main management surface becomes:

- `openclaw-router setup`
- `openclaw-router status`
- `openclaw-router doctor`
- `openclaw-router repair`
- `openclaw-router account list`
- `openclaw-router account add`
- `openclaw-router account enable`
- `openclaw-router account disable`
- `openclaw-router account order`

The current low-level command surface can remain internally, but the top-level help should favor this simpler user model.

## Integration strategy

### Recommended architecture

Use a managed shim model rather than a long-running routing daemon.

Reasoning:

- Routing is request-scoped, not event-stream scoped.
- State is already file-based and durable.
- A shim is easier to install, repair, inspect, and roll back than process-level interception.
- This keeps compatibility with OpenClaw's existing CLI behavior while still making the router effectively invisible after setup.

### Runtime path

Normal daily flow:

```text
user -> openclaw
     -> router-managed shim
     -> openclaw-router internal run path
     -> real openclaw binary
```

The shim should:

1. Resolve the real `openclaw` binary path from persisted integration config.
2. Call router runtime logic.
3. Forward all original arguments unchanged.
4. Preserve stdout, stderr, and exit semantics as much as practical.

### Why still install platform service files

Even with shim-first execution, platform-specific service assets are still useful for:

- keeping integration discoverable and repairable,
- publishing stable install metadata,
- supporting future background maintenance tasks,
- giving operators a native place to inspect status and restart integration.

This phase does not require a permanent daemon to process every request. Service integration is mainly for lifecycle management and platform alignment.

## Platform behavior

### macOS

Install:

- router-managed bin directory under the user's home,
- shim script for `openclaw`,
- `launchd` plist for integration repair/maintenance,
- helper commands to load/reload the plist.

The setup output must tell the user:

- where the shim was installed,
- whether PATH ordering is sufficient,
- how to run `launchctl print` for inspection,
- how to run `openclaw-router repair`.

### Linux

Install:

- router-managed bin directory under the user's home,
- shim script for `openclaw`,
- `systemd --user` unit for integration repair/maintenance,
- helper commands to `systemctl --user daemon-reload` and restart.

The setup output must tell the user:

- where the shim was installed,
- whether PATH ordering is sufficient,
- how to inspect `systemctl --user status`,
- how to run `openclaw-router repair`.

## CLI redesign

### New top-level command model

#### `openclaw-router setup`

Responsibility:

- initialize router install,
- discover Codex profiles,
- bootstrap account bindings,
- install shim and service metadata,
- verify final state.

Expected behavior:

- idempotent,
- safe to rerun,
- can repair a partial install,
- defaults to interactive-friendly behavior but still usable from scripts.

#### `openclaw-router status`

Responsibility:

- summarize installation health and routing state in one command.

Should include:

- integration installed or not,
- shim path,
- real `openclaw` path,
- active accounts,
- cooldowns,
- next candidate,
- last provider fallback reason.

#### `openclaw-router doctor`

Responsibility:

- deeper diagnostics for broken installs.

Should include:

- real binary exists,
- auth store readable/writable,
- router state valid,
- shim installed,
- service metadata present,
- alias/profile mapping valid,
- PATH advice if shim is not taking effect.

#### `openclaw-router repair`

Responsibility:

- reinstall or refresh shim/service/config integration without rebinding accounts.

#### `openclaw-router account ...`

Responsibility:

- simple account lifecycle operations.

Subcommands:

- `list`
- `add`
- `enable`
- `disable`
- `order`

Naming note:

`add` is more user-friendly than `bind`, but internal bind logic can be reused.

## Persistent state design

### Existing state remains valid

- Router state: `config/accounts.json`
- OpenClaw auth store: `~/.openclaw/agents/main/agent/auth-profiles.json`

### New integration state

Add a dedicated integration state file, likely under a router-managed directory in the user's home.

It should persist:

- platform,
- install root,
- shim path,
- real `openclaw` binary path,
- service file path,
- last successful setup timestamp,
- version of installed integration.

This state prevents setup/repair from re-discovering everything heuristically on every run.

## Implementation boundaries

### New modules expected

- install/integration path helpers
- shim installer
- service file generator
- setup flow orchestration
- repair flow orchestration
- integration status inspection

### Existing modules to preserve

- account store schema and persistence
- OpenClaw auth-store bridge
- runtime retry router
- classifier

The existing routing core should remain mostly intact. The primary work is packaging, integration, and CLI simplification.

## Error handling

### Setup failures

If setup fails midway:

- keep previous working integration if one exists,
- never delete the real `openclaw` binary,
- report which step failed,
- provide the exact `repair` or cleanup action.

### Shim failures

If the shim cannot locate router config or the real binary:

- fail loudly with actionable stderr,
- include the path it expected,
- suggest `openclaw-router doctor` or `openclaw-router repair`.

### Account bootstrap failures

If Codex accounts cannot be discovered:

- setup may still install integration,
- but must clearly say “routing inactive until at least one Codex account is added”.

## Testing strategy

### Required coverage

1. Setup flow writes integration state and artifacts.
2. Setup flow is idempotent.
3. macOS service file rendering is correct.
4. Linux service file rendering is correct.
5. Shim forwards arguments to router runtime.
6. `account add` maps cleanly onto current bind behavior.
7. `status` includes installation health in addition to routing health.
8. `repair` restores missing shim/service artifacts.

### Integration tests

At least one real-process test should verify:

- `openclaw-router setup` installs a shim,
- subsequent `openclaw ...` invocation goes through the router path,
- pool exhaustion still triggers final fallback.

## Acceptance criteria

The feature is done when all of these are true:

1. A new user can run `openclaw-router setup` on macOS or Linux.
2. The setup process installs a usable integration without editing shell scripts by hand.
3. After setup, the user can keep using `openclaw ...` naturally.
4. A separate `openclaw-router` command exists for management and repair.
5. Routing behavior remains compatible with current acceptance tests.
6. Documentation explains:
   - first-time setup,
   - repair,
   - uninstall/rollback,
   - how OpenClaw integration works.

## Risks

### PATH precedence

The shim model depends on the router-managed bin directory appearing before the real `openclaw` path. Setup and doctor must detect and explain this clearly.

### Cross-platform service differences

`launchd` and `systemd --user` should be rendered from a common conceptual model, but platform-specific install steps must stay isolated.

### Backward compatibility

Current power-user commands should not disappear immediately. They can be preserved while the new user-facing command surface becomes primary.
