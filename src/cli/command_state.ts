import { loadIntegrationState } from "../integration/store.js";
import {
  resolveAuthStorePath,
  resolveOptionalIntegrationStatePath,
  resolveRouterStatePath
} from "../shared/paths.js";

export async function resolveCommandState(params?: {
  routerState?: string;
  authStore?: string;
  integrationState?: string;
}): Promise<{
  integrationStatePath?: string;
  routerStatePath: string;
  authStorePath: string;
}> {
  const integrationStatePath = resolveOptionalIntegrationStatePath(params?.integrationState);
  const integrationState = integrationStatePath
    ? await loadIntegrationState(integrationStatePath)
    : undefined;

  return {
    integrationStatePath,
    routerStatePath: resolveRouterStatePath(
      (params?.routerState as string | undefined) ?? integrationState?.routerStatePath
    ),
    authStorePath: resolveAuthStorePath(
      (params?.authStore as string | undefined) ?? integrationState?.authStorePath
    )
  };
}
