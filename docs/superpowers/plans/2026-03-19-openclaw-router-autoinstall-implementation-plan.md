# OpenClaw Router Autoinstall Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the project into a user-facing `openclaw-router` command that can install and repair a macOS/Linux OpenClaw integration, while keeping Codex pool routing behavior intact.

**Architecture:** Keep the current routing core as-is and add a separate integration layer: persistent install state, platform-specific service renderers, a managed `openclaw` shim, and a simplified CLI surface. The shim becomes the invisible runtime path after setup, while `openclaw-router` remains the explicit management command.

**Tech Stack:** Node.js 20+, TypeScript, Commander, Zod, Execa, Vitest, file-based state, launchd (macOS), systemd --user (Linux)

---

## File map

### New files

- `src/integration/schema.ts`
- `src/integration/store.ts`
- `src/integration/types.ts`
- `src/integration/paths.ts`
- `src/integration/discovery.ts`
- `src/integration/shim.ts`
- `src/integration/service_templates.ts`
- `src/integration/setup.ts`
- `src/integration/repair.ts`
- `src/cli/commands/setup.ts`
- `src/cli/commands/repair.ts`
- `src/cli/commands/account.ts`
- `test/integration/store.test.ts`
- `test/integration/service_templates.test.ts`
- `test/integration/shim.test.ts`
- `test/cli/setup.test.ts`
- `test/cli/repair.test.ts`
- `test/cli/account.test.ts`
- `test/cli/openclaw_shim.integration.test.ts`

### Existing files to modify

- `package.json`
- `README.md`
- `AGENTS.md`
- `src/cli/main.ts`
- `src/cli/commands/status.ts`
- `src/cli/commands/doctor.ts`
- `src/cli/commands/run.ts`
- `src/shared/paths.ts`
- `test/cli/help.test.ts`
- `test/cli/status.test.ts`
- `test/cli/doctor.test.ts`
- `test/cli/run.integration.test.ts`

### Existing files intentionally preserved as routing core

- `src/account_store/*`
- `src/classifier/*`
- `src/router/*`

## Chunk 1: Integration state and path helpers

### Task 1: Add persistent integration state

**Files:**
- Create: `src/integration/types.ts`
- Create: `src/integration/schema.ts`
- Create: `src/integration/store.ts`
- Test: `test/integration/store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { loadIntegrationState, saveIntegrationState } from "../../src/integration/store.js";

describe("integration state store", () => {
  it("round-trips integration metadata", async () => {
    const state = {
      version: 1,
      platform: "darwin",
      installRoot: "/tmp/router",
      shimPath: "/tmp/router/bin/openclaw",
      realOpenClawPath: "/usr/local/bin/openclaw",
      servicePath: "/tmp/router/service.plist",
      lastSetupAt: "2026-03-19T10:00:00.000Z"
    };

    await saveIntegrationState("/tmp/router-install.json", state);
    const loaded = await loadIntegrationState("/tmp/router-install.json");

    expect(loaded.realOpenClawPath).toBe("/usr/local/bin/openclaw");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/integration/store.test.ts`
Expected: FAIL because integration store modules do not exist.

- [ ] **Step 3: Write minimal implementation**

Add:

- `IntegrationState` type with:
  - `version: 1`
  - `platform: "darwin" | "linux"`
  - `installRoot: string`
  - `shimPath: string`
  - `realOpenClawPath: string`
  - `servicePath: string`
  - `lastSetupAt: string`
- Zod schema for validation
- atomic save + load behavior matching existing router state store style

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/integration/store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/integration/types.ts src/integration/schema.ts src/integration/store.ts test/integration/store.test.ts
git commit -m "feat: add integration state store"
```

### Task 2: Add integration path helpers and discovery primitives

**Files:**
- Create: `src/integration/paths.ts`
- Create: `src/integration/discovery.ts`
- Modify: `src/shared/paths.ts`
- Test: `test/integration/shim.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { resolveIntegrationPaths } from "../../src/integration/paths.js";

describe("integration paths", () => {
  it("builds managed bin and service paths under the user home", () => {
    const paths = resolveIntegrationPaths("/Users/tester", "darwin");
    expect(paths.binDir).toContain(".openclaw-router");
    expect(paths.shimPath.endsWith("/openclaw")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/integration/shim.test.ts`
Expected: FAIL because path helpers do not exist.

- [ ] **Step 3: Write minimal implementation**

Add helpers for:

- install root under `~/.openclaw-router`
- managed bin dir
- integration state path
- service file path:
  - `launchd` plist on macOS
  - `systemd --user` unit on Linux

Also add discovery helpers for:

- resolving `HOME`
- detecting platform
- resolving current `openclaw` binary path

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/integration/shim.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/integration/paths.ts src/integration/discovery.ts src/shared/paths.ts test/integration/shim.test.ts
git commit -m "feat: add integration path and discovery helpers"
```

## Chunk 2: Shim and service rendering

### Task 3: Render platform service files

**Files:**
- Create: `src/integration/service_templates.ts`
- Test: `test/integration/service_templates.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { renderServiceDefinition } from "../../src/integration/service_templates.js";

describe("service templates", () => {
  it("renders a launchd plist for macOS", () => {
    const text = renderServiceDefinition({
      platform: "darwin",
      installRoot: "/Users/tester/.openclaw-router"
    });

    expect(text).toContain("<plist");
    expect(text).toContain("openclaw-router");
  });

  it("renders a systemd user unit for linux", () => {
    const text = renderServiceDefinition({
      platform: "linux",
      installRoot: "/home/tester/.openclaw-router"
    });

    expect(text).toContain("[Unit]");
    expect(text).toContain("ExecStart=");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/integration/service_templates.test.ts`
Expected: FAIL because renderer does not exist.

- [ ] **Step 3: Write minimal implementation**

Render stable text definitions for:

- `launchd` plist
- `systemd --user` service

These services are maintenance-oriented and must reference the router install root and repair entrypoint.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/integration/service_templates.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/integration/service_templates.ts test/integration/service_templates.test.ts
git commit -m "feat: add platform service templates"
```

### Task 4: Install and repair the managed `openclaw` shim

**Files:**
- Create: `src/integration/shim.ts`
- Test: `test/integration/shim.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { renderOpenClawShim } from "../../src/integration/shim.js";

describe("openclaw shim", () => {
  it("forwards to openclaw-router runtime entrypoint", () => {
    const text = renderOpenClawShim({
      routerCommand: "/Users/tester/.openclaw-router/bin/openclaw-router",
      integrationStatePath: "/Users/tester/.openclaw-router/integration.json"
    });

    expect(text).toContain("openclaw-router");
    expect(text).toContain("exec");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/integration/shim.test.ts`
Expected: FAIL because shim renderer does not exist.

- [ ] **Step 3: Write minimal implementation**

Add:

- shim text renderer
- installer that writes executable shim
- repair helper that rewrites shim idempotently

The shim must:

- load integration state path
- locate the real OpenClaw binary from persisted state
- forward original CLI args unchanged

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/integration/shim.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/integration/shim.ts test/integration/shim.test.ts
git commit -m "feat: add managed openclaw shim"
```

## Chunk 3: Setup and repair orchestration

### Task 5: Implement `setup` orchestration

**Files:**
- Create: `src/integration/setup.ts`
- Create: `src/cli/commands/setup.ts`
- Test: `test/cli/setup.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { runSetup } from "../../src/integration/setup.js";

describe("setup flow", () => {
  it("discovers codex profiles and installs integration artifacts", async () => {
    const result = await runSetup({
      homeDir: "/tmp/test-home",
      platform: "linux"
    }, {
      discoverOpenClawProfiles: async () => ["openai-codex:a@example.com", "openai-codex:b@example.com"],
      resolveOpenClawBinary: async () => "/usr/bin/openclaw"
    });

    expect(result.installed).toBe(true);
    expect(result.discoveredProfiles.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/cli/setup.test.ts`
Expected: FAIL because setup orchestration does not exist.

- [ ] **Step 3: Write minimal implementation**

Setup flow should:

- detect platform and binary
- discover Codex profiles from OpenClaw auth store
- bootstrap router state if missing
- bind default aliases `acct-1`, `acct-2`, ...
- install shim
- write service definition
- persist integration state

CLI:

- add top-level `setup`
- keep output concise
- support `--json`

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/cli/setup.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/integration/setup.ts src/cli/commands/setup.ts test/cli/setup.test.ts
git commit -m "feat: add setup command and orchestration"
```

### Task 6: Implement `repair` orchestration

**Files:**
- Create: `src/integration/repair.ts`
- Create: `src/cli/commands/repair.ts`
- Test: `test/cli/repair.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { runRepair } from "../../src/integration/repair.js";

describe("repair flow", () => {
  it("reinstalls missing shim and service files from persisted integration state", async () => {
    const result = await runRepair("/tmp/router-install.json");
    expect(result.repaired).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/cli/repair.test.ts`
Expected: FAIL because repair orchestration does not exist.

- [ ] **Step 3: Write minimal implementation**

Repair should:

- load integration state
- regenerate shim
- regenerate service file
- print actionable next steps if PATH or service reload is required

Add top-level `repair` command.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/cli/repair.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/integration/repair.ts src/cli/commands/repair.ts test/cli/repair.test.ts
git commit -m "feat: add integration repair flow"
```

## Chunk 4: CLI simplification

### Task 7: Replace low-level `accounts` with user-facing `account`

**Files:**
- Create: `src/cli/commands/account.ts`
- Modify: `src/cli/main.ts`
- Test: `test/cli/account.test.ts`
- Modify: `test/cli/help.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { execa } from "execa";

describe("top-level help", () => {
  it("shows setup, status, doctor, repair, and account commands", async () => {
    const { stdout } = await execa("node", ["--import", "tsx", "src/cli/main.ts", "--help"]);
    expect(stdout).toContain("setup");
    expect(stdout).toContain("repair");
    expect(stdout).toContain("account");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/cli/help.test.ts test/cli/account.test.ts`
Expected: FAIL because new command surface does not exist.

- [ ] **Step 3: Write minimal implementation**

Add new user-facing group:

- `account list`
- `account add`
- `account enable`
- `account disable`
- `account order`

Map `account add` onto existing bind logic.

Keep current low-level commands available only if needed for compatibility, but do not feature them in top-level help.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/cli/help.test.ts test/cli/account.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/account.ts src/cli/main.ts test/cli/help.test.ts test/cli/account.test.ts
git commit -m "feat: simplify cli around setup and account commands"
```

### Task 8: Extend `status` and `doctor` with installation health

**Files:**
- Modify: `src/cli/commands/status.ts`
- Modify: `src/cli/commands/doctor.ts`
- Test: `test/cli/status.test.ts`
- Modify: `test/cli/doctor.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe("status cli", () => {
  it("shows integration health along with routing health", async () => {
    const payload = await getRouterStatus({
      routerStatePath,
      integrationStatePath
    });

    expect(payload.integration.installed).toBe(true);
    expect(payload.integration.shimPath).toContain("openclaw");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/cli/status.test.ts test/cli/doctor.test.ts`
Expected: FAIL because installation health is not yet included.

- [ ] **Step 3: Write minimal implementation**

`status` should include:

- integration installed
- shim path
- real OpenClaw path

`doctor` should also validate:

- integration state readable
- shim exists
- service file exists
- PATH advice if shim path is not ahead of real binary

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/cli/status.test.ts test/cli/doctor.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/status.ts src/cli/commands/doctor.ts test/cli/status.test.ts test/cli/doctor.test.ts
git commit -m "feat: add installation health to status and doctor"
```

## Chunk 5: Real integration behavior

### Task 9: Verify shimmed `openclaw` path with a real child process

**Files:**
- Create: `test/cli/openclaw_shim.integration.test.ts`
- Modify: `test/fixtures/fake-openclaw-pool.mjs`

- [ ] **Step 1: Write the failing test**

```ts
describe("openclaw shim integration", () => {
  it("routes a plain openclaw invocation through the shim after setup", async () => {
    const result = await execa("openclaw", ["agent", "--message", "ping"], {
      env: { PATH: `${managedBinDir}:${process.env.PATH}` }
    });

    expect(result.stdout).toContain("fallback-ok");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/cli/openclaw_shim.integration.test.ts`
Expected: FAIL because setup does not yet install a usable shim path.

- [ ] **Step 3: Write minimal implementation**

Ensure setup + shim installation is sufficient for a plain `openclaw` invocation to flow through router logic and preserve existing fallback behavior.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/cli/openclaw_shim.integration.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add test/cli/openclaw_shim.integration.test.ts test/fixtures/fake-openclaw-pool.mjs
git commit -m "test: cover shimmed openclaw integration path"
```

## Chunk 6: Docs and packaging

### Task 10: Package and document the new user model

**Files:**
- Modify: `package.json`
- Modify: `README.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: Write the failing test**

Use a doc-validation mindset rather than a code test:

- top-level help should mention new user-facing commands
- README should document:
  - `openclaw-router setup`
  - repair
  - uninstall/rollback
  - OpenClaw integration model

- [ ] **Step 2: Run checks to verify gaps**

Run:

```bash
node --import tsx src/cli/main.ts --help
rg -n "openclaw-router setup|repair|rollback|shim" README.md AGENTS.md
```

Expected: at least one missing or outdated reference before final edits.

- [ ] **Step 3: Write minimal implementation**

Update:

- package metadata and executable story for `openclaw-router`
- README with:
  - quick start
  - setup
  - daily usage
  - repair
  - uninstall/rollback
  - macOS and Linux notes
- AGENTS.md with:
  - new command surface
  - integration invariants
  - testing requirements

- [ ] **Step 4: Run final verification**

Run:

```bash
pnpm test
pnpm build
node --import tsx src/cli/main.ts --help
node --import tsx src/cli/main.ts setup --help
node --import tsx src/cli/main.ts account --help
```

Expected: all pass and help output matches the new model.

- [ ] **Step 5: Commit**

```bash
git add package.json README.md AGENTS.md
git commit -m "docs: document autoinstall workflow and new cli"
```

## Final verification checklist

- [ ] `pnpm test`
- [ ] `pnpm build`
- [ ] `node --import tsx src/cli/main.ts --help`
- [ ] `node --import tsx src/cli/main.ts setup --help`
- [ ] `node --import tsx src/cli/main.ts account --help`
- [ ] one macOS fixture test for generated `launchd` service
- [ ] one Linux fixture test for generated `systemd --user` service
- [ ] one real-process shim integration test proving `openclaw ...` is routed after setup

## Notes for implementers

- Do not replace or mutate the real OpenClaw binary.
- The shim must be reversible and inspectable.
- Keep current routing semantics unchanged while changing packaging and UX.
- Favor idempotent setup and repair over “smart” implicit mutation.
- If PATH precedence cannot be fixed automatically, doctor must explain the exact manual action needed.
