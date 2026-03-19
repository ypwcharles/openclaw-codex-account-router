import path from "node:path";
import { resolveDefaultOpenClawAuthStorePath } from "../router/openclaw_paths.js";

export function resolveRouterStatePath(explicit?: string): string {
  const raw = explicit?.trim();
  if (raw) {
    return path.resolve(raw);
  }
  return path.resolve(process.cwd(), "config", "accounts.json");
}

export function resolveAuthStorePath(explicit?: string): string {
  const raw = explicit?.trim();
  if (raw) {
    return path.resolve(raw);
  }
  return resolveDefaultOpenClawAuthStorePath();
}
