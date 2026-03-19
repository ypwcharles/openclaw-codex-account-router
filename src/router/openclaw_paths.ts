import path from "node:path";

export function resolveDefaultOpenClawAuthStorePath(): string {
  const home = process.env.HOME;
  if (!home) {
    throw new Error("HOME is not set; cannot resolve default OpenClaw auth store path.");
  }
  return path.join(home, ".openclaw", "agents", "main", "agent", "auth-profiles.json");
}
