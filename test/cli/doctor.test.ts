import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runDoctor } from "../../src/cli/commands/doctor.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(cleanupPaths.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

describe("doctor command", () => {
  it(
    "returns failed checks instead of throwing when auth store json is invalid",
    async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "doctor-cli-"));
      cleanupPaths.push(dir);
      const routerStatePath = path.join(dir, "router-state.json");
      const authStorePath = path.join(dir, "auth-profiles.json");

      await writeFile(
        routerStatePath,
        JSON.stringify(
          {
            version: 1,
            accounts: [
              {
                alias: "acct-a",
                profileId: "openai-codex:a@example.com",
                provider: "openai-codex",
                priority: 10,
                status: "healthy",
                enabled: true
              }
            ]
          },
          null,
          2
        ),
        "utf8"
      );
      await writeFile(authStorePath, "{invalid json", "utf8");

      const result = await runDoctor({
        routerStatePath,
        authStorePath
      });
      const mapping = result.checks.find((check) => check.id === "alias_profile_mapping");

      expect(mapping?.ok).toBe(false);
      expect(mapping?.detail).toContain("cannot read/parse auth store");
    },
    15000
  );

  it("validates integration artifacts from integration state", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "doctor-intg-"));
    cleanupPaths.push(dir);
    const routerStatePath = path.join(dir, "router-state.json");
    const authStorePath = path.join(dir, "auth-profiles.json");
    const integrationStatePath = path.join(dir, "integration.json");
    const shimPath = path.join(dir, "bin", "openclaw");
    const servicePath = path.join(dir, "services", "openclaw-router-repair.service");

    await writeFile(
      routerStatePath,
      JSON.stringify({ version: 1, accounts: [] }, null, 2),
      "utf8"
    );
    await writeFile(
      authStorePath,
      JSON.stringify({ version: 1, profiles: {} }, null, 2),
      "utf8"
    );
    await writeFile(
      integrationStatePath,
      JSON.stringify(
        {
          version: 1,
          platform: "linux",
          installRoot: dir,
          shimPath,
          realOpenClawPath: "/usr/bin/openclaw",
          servicePath,
          lastSetupAt: "2026-03-19T10:00:00.000Z"
        },
        null,
        2
      ),
      "utf8"
    );

    await mkdir(path.dirname(shimPath), { recursive: true });
    await writeFile(shimPath, "#!/usr/bin/env bash\n", "utf8");

    const result = await runDoctor({
      routerStatePath,
      authStorePath,
      integrationStatePath
    });

    const integrationReadable = result.checks.find((check) => check.id === "integration_state_readable");
    const shimExists = result.checks.find((check) => check.id === "integration_shim_exists");
    const serviceExists = result.checks.find((check) => check.id === "integration_service_exists");

    expect(integrationReadable?.ok).toBe(true);
    expect(shimExists?.ok).toBe(true);
    expect(serviceExists?.ok).toBe(false);
  });
});
