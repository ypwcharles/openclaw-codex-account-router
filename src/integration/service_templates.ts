import path from "node:path";
import type { IntegrationPlatform } from "./types.js";

export function renderServiceDefinition(params: {
  platform: IntegrationPlatform;
  installRoot: string;
}): string {
  const routerCommand = path.join(params.installRoot, "bin", "openclaw-router");

  if (params.platform === "darwin") {
    return renderLaunchdService(routerCommand);
  }
  return renderSystemdUserService(routerCommand);
}

function renderLaunchdService(routerCommand: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>dev.openclaw-router.repair</string>
    <key>ProgramArguments</key>
    <array>
      <string>${xmlEscape(routerCommand)}</string>
      <string>repair</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
  </dict>
</plist>
`;
}

function renderSystemdUserService(routerCommand: string): string {
  return `[Unit]
Description=OpenClaw Router Repair

[Service]
Type=oneshot
ExecStart=${systemdEscape(routerCommand)} repair

[Install]
WantedBy=default.target
`;
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function systemdEscape(value: string): string {
  if (!/[\s"'\\]/.test(value)) {
    return value;
  }
  return `"${value.replace(/(["\\])/g, "\\$1")}"`;
}
