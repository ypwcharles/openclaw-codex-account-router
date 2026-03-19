export type IntegrationPlatform = "darwin" | "linux";

export type IntegrationState = {
  version: 1;
  platform: IntegrationPlatform;
  installRoot: string;
  shimPath: string;
  realOpenClawPath: string;
  servicePath: string;
  lastSetupAt: string;
  routerStatePath?: string;
  authStorePath?: string;
};

export type IntegrationPaths = {
  installRoot: string;
  binDir: string;
  shimPath: string;
  routerCommandPath: string;
  integrationStatePath: string;
  servicePath: string;
};
