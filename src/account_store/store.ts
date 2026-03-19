import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import lockfile from "proper-lockfile";
import { RouterStateSchema } from "./schema.js";
import type { RouterState } from "./types.js";

const EMPTY_STATE: RouterState = {
  version: 1,
  accounts: []
};

export async function loadRouterState(statePath: string): Promise<RouterState> {
  try {
    const raw = await readFile(statePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return RouterStateSchema.parse(parsed);
  } catch (error) {
    if (isFileNotFound(error)) {
      return EMPTY_STATE;
    }
    throw error;
  }
}

export async function saveRouterState(statePath: string, state: RouterState): Promise<void> {
  const validated = RouterStateSchema.parse(state);
  const dir = path.dirname(statePath);
  const lockPath = path.join(dir, ".router-state.lock");
  const tempPath = `${statePath}.tmp`;

  await mkdir(dir, { recursive: true });
  const release = await lockfile.lock(dir, {
    lockfilePath: lockPath,
    retries: {
      retries: 4,
      factor: 1.4,
      minTimeout: 50,
      maxTimeout: 250
    }
  });

  try {
    await writeFile(tempPath, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
    await rename(tempPath, statePath);
  } finally {
    await release();
  }
}

function isFileNotFound(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT"
  );
}
