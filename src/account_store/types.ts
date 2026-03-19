export type AccountStatus = "healthy" | "cooldown" | "disabled" | "unknown";

export type RouterAccount = {
  alias: string;
  profileId: string;
  provider: "openai-codex";
  priority: number;
  status: AccountStatus;
  enabled: boolean;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  lastErrorCode?: string;
  cooldownUntil?: string;
};

export type RouterState = {
  version: 1;
  accounts: RouterAccount[];
};
