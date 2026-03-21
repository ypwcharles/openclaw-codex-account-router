import { loadIntegrationState } from "../integration/store.js";
import {
  resolveAuthStorePath,
  resolveOptionalIntegrationStatePath,
  resolveRouterStatePath
} from "../shared/paths.js";

type CommandStateParams = {
  routerState?: string;
  authStore?: string;
  integrationState?: string;
};

export async function resolveCommandState(
  params: CommandStateParams & { requireAuthStore: true }
): Promise<{
  integrationStatePath?: string;
  routerStatePath: string;
  authStorePath: string;
}>;
export async function resolveCommandState(
  params?: CommandStateParams & { requireAuthStore?: false }
): Promise<{
  integrationStatePath?: string;
  routerStatePath: string;
  authStorePath?: string;
}>;
export async function resolveCommandState(
  params?: CommandStateParams & { requireAuthStore?: boolean }
): Promise<{
  integrationStatePath?: string;
  routerStatePath: string;
  authStorePath?: string;
}> {
  const integrationStatePath = resolveOptionalIntegrationStatePath(params?.integrationState);
  const explicitRouterState = params?.routerState as string | undefined;
  const explicitAuthStore = params?.authStore as string | undefined;
  const requireAuthStore = Boolean(params?.requireAuthStore);
  const needsIntegrationState =
    (!explicitRouterState || (requireAuthStore && !explicitAuthStore)) && Boolean(integrationStatePath);
  const integrationState =
    needsIntegrationState && integrationStatePath
      ? await loadIntegrationState(integrationStatePath)
      : undefined;

  const routerStatePath = resolveRouterStatePath(explicitRouterState ?? integrationState?.routerStatePath);
  const authStorePath = requireAuthStore
    ? resolveAuthStorePath(explicitAuthStore ?? integrationState?.authStorePath)
    : undefined;

  return {
    integrationStatePath,
    routerStatePath,
    authStorePath
  };
}
