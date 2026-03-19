import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import lockfile from "proper-lockfile";
import { loadIntegrationState } from "./store.js";

export type RestoreResult = {
  restored: true;
  authStorePath: string;
  backupPath: string;
};

export async function runRestore(params: {
  integrationStatePath: string;
  authStorePath?: string;
}): Promise<RestoreResult> {
  const state = await loadIntegrationState(params.integrationStatePath);
  if (!state) {
    throw new Error(`integration state not found: ${params.integrationStatePath}`);
  }

  const authStorePath = params.authStorePath ?? state.authStorePath;
  if (!authStorePath) {
    throw new Error("auth store path is not available; pass --auth-store explicitly");
  }

  const backupPath =
    state.authStoreBackupPath ??
    path.join(state.installRoot, "backups", "auth-profiles.pre-router.json");
  const backupRaw = await readFile(backupPath, "utf8");
  await writeAtomically(authStorePath, backupRaw);

  return {
    restored: true,
    authStorePath,
    backupPath
  };
}

async function writeAtomically(targetPath: string, content: string): Promise<void> {
  const dir = path.dirname(targetPath);
  const lockPath = path.join(dir, ".auth-store-restore.lock");
  const tempPath = `${targetPath}.tmp`;

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
    await writeFile(tempPath, content, "utf8");
    await rename(tempPath, targetPath);
  } finally {
    await release();
  }
}

