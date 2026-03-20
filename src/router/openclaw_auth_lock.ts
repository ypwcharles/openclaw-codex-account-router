import path from "node:path";

export const OPENCLAW_AUTH_LOCK_FILENAME = ".openclaw-auth-profiles.lock";

export function getOpenClawAuthLockPath(authStorePath: string): string {
  return path.join(path.dirname(authStorePath), OPENCLAW_AUTH_LOCK_FILENAME);
}
