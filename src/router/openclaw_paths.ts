import path from "node:path";

function resolveDefaultOpenClawRootPath(): string {
  const home = process.env.HOME;
  if (!home) {
    throw new Error("HOME is not set; cannot resolve default OpenClaw paths.");
  }
  return path.join(home, ".openclaw");
}

export function resolveDefaultOpenClawAuthStorePath(): string {
  return path.join(resolveDefaultOpenClawRootPath(), "agents", "main", "agent", "auth-profiles.json");
}

export function resolveDefaultOpenClawSessionStorePath(): string {
  return path.join(resolveDefaultOpenClawRootPath(), "agents", "main", "sessions", "sessions.json");
}

export function resolveDefaultOpenClawGatewayServicePath(): string {
  const home = process.env.HOME;
  if (!home) {
    throw new Error("HOME is not set; cannot resolve default OpenClaw gateway service path.");
  }
  return path.join(home, ".config", "systemd", "user", "openclaw-gateway.service");
}
