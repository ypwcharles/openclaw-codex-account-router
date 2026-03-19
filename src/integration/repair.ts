import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { renderServiceDefinition } from "./service_templates.js";
import { repairOpenClawShim } from "./shim.js";
import { loadIntegrationState } from "./store.js";

export type RepairResult = {
  repaired: true;
  shimPath: string;
  servicePath: string;
  notes: string[];
};

export async function runRepair(
  integrationStatePath: string
): Promise<RepairResult> {
  const state = await loadIntegrationState(integrationStatePath);
  if (!state) {
    throw new Error(`integration state not found: ${integrationStatePath}`);
  }

  const routerCommand = path.join(state.installRoot, "bin", "openclaw-router");
  await repairOpenClawShim({
    shimPath: state.shimPath,
    routerCommand,
    integrationStatePath
  });

  const serviceText = renderServiceDefinition({
    platform: state.platform,
    installRoot: state.installRoot
  });
  await mkdir(path.dirname(state.servicePath), { recursive: true });
  await writeFile(state.servicePath, serviceText, "utf8");

  return {
    repaired: true,
    shimPath: state.shimPath,
    servicePath: state.servicePath,
    notes: buildRepairNotes(state.shimPath, state.realOpenClawPath, process.env.PATH ?? "")
  };
}

function buildRepairNotes(shimPath: string, realOpenClawPath: string, pathEnv: string): string[] {
  const notes: string[] = [];
  const entries = pathEnv.split(path.delimiter).filter(Boolean);
  const shimDir = path.dirname(shimPath);
  const realDir = path.dirname(realOpenClawPath);
  const shimIndex = entries.indexOf(shimDir);
  const realIndex = entries.indexOf(realDir);

  if (shimIndex < 0 || (realIndex >= 0 && shimIndex > realIndex)) {
    notes.push(`Ensure ${shimDir} appears before ${realDir} in PATH.`);
  }

  if (process.platform === "darwin") {
    notes.push("If using launchd, reload the user agent after repair.");
  } else if (process.platform === "linux") {
    notes.push("If using systemd --user, run daemon-reload and restart the unit.");
  }

  return notes;
}
