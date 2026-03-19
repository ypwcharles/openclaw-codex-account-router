import { access, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runRepair } from "../../src/integration/repair.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(cleanupPaths.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

describe("repair flow", () => {
  it("reinstalls missing shim and service files from persisted integration state", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "repair-flow-"));
    cleanupPaths.push(dir);

    const shimPath = path.join(dir, "bin", "openclaw");
    const servicePath = path.join(dir, "services", "openclaw-router-repair.service");
    const integrationStatePath = path.join(dir, "integration.json");

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

    const result = await runRepair(integrationStatePath);
    expect(result.repaired).toBe(true);

    await access(shimPath);
    await access(servicePath);
  });
});
