import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import lockfile from "proper-lockfile";
import { IntegrationStateSchema } from "./schema.js";
import type { IntegrationState } from "./types.js";

export async function loadIntegrationState(
  statePath: string
): Promise<IntegrationState | undefined> {
  try {
    const raw = await readFile(statePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return IntegrationStateSchema.parse(parsed);
  } catch (error) {
    if (isFileNotFound(error)) {
      return undefined;
    }
    throw error;
  }
}

export async function saveIntegrationState(
  statePath: string,
  state: IntegrationState
): Promise<void> {
  const validated = IntegrationStateSchema.parse(state);
  const dir = path.dirname(statePath);
  const lockPath = path.join(dir, ".integration-state.lock");
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
