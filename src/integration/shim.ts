import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

type RenderOpenClawShimParams = {
  routerCommand: string;
  integrationStatePath: string;
};

export function renderOpenClawShim(params: RenderOpenClawShimParams): string {
  const routerCommand = shellEscape(params.routerCommand);
  const statePath = shellEscape(params.integrationStatePath);

  return `#!/usr/bin/env bash
set -euo pipefail

SHIM_PATH="$0"
STATE_PATH=${statePath}
ROUTER_COMMAND=${routerCommand}

if [ ! -f "$STATE_PATH" ]; then
  echo "openclaw-router integration state not found: $STATE_PATH" >&2
  exit 1
fi

REAL_OPENCLAW="$(node --input-type=module -e 'import { readFileSync } from "node:fs"; const p = process.argv[1]; const state = JSON.parse(readFileSync(p, "utf8")); const bin = state.realOpenClawPath; if (!bin || typeof bin !== "string") { process.exit(12); } process.stdout.write(bin);' "$STATE_PATH")"

if [ -z "$REAL_OPENCLAW" ]; then
  echo "openclaw-router integration state missing realOpenClawPath" >&2
  exit 1
fi

if [ "$REAL_OPENCLAW" = "$SHIM_PATH" ]; then
  echo "openclaw-router integration state is misconfigured: realOpenClawPath points to shim ($SHIM_PATH)" >&2
  exit 1
fi

case "\${1:-}" in
  tui|update|--update)
    exec "$REAL_OPENCLAW" "$@"
    ;;
esac

exec "$ROUTER_COMMAND" run --integration-state "$STATE_PATH" -- "$REAL_OPENCLAW" "$@"
`;
}

export async function installOpenClawShim(params: {
  shimPath: string;
  routerCommand: string;
  integrationStatePath: string;
}): Promise<void> {
  const shimText = renderOpenClawShim({
    routerCommand: params.routerCommand,
    integrationStatePath: params.integrationStatePath
  });
  await mkdir(path.dirname(params.shimPath), { recursive: true });
  await writeFile(params.shimPath, shimText, "utf8");
  await chmod(params.shimPath, 0o755);
}

export async function repairOpenClawShim(params: {
  shimPath: string;
  routerCommand: string;
  integrationStatePath: string;
}): Promise<void> {
  await installOpenClawShim(params);
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}
