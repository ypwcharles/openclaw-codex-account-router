import { bindAccount, listAccounts } from "../account_store/bind.js";

export async function ensureBindingsForProfiles(params: {
  profileIds: string[];
  routerStatePath: string;
  authStorePath: string;
}): Promise<Array<{ alias: string; profileId: string }>> {
  const discovered = [...new Set(params.profileIds.map((id) => id.trim()).filter(Boolean))];
  if (discovered.length === 0) {
    return [];
  }

  const existing = await listAccounts(params.routerStatePath);
  const existingAliases = new Set(existing.map((account) => account.alias));
  const existingProfiles = new Set(existing.map((account) => account.profileId));
  const created: Array<{ alias: string; profileId: string }> = [];

  let aliasIndex = nextAliasIndex(existingAliases);
  for (const profileId of discovered) {
    if (existingProfiles.has(profileId)) {
      continue;
    }

    const alias = resolveNextAlias(existingAliases, aliasIndex);
    aliasIndex += 1;

    await bindAccount({
      alias,
      profileId,
      routerStatePath: params.routerStatePath,
      authStorePath: params.authStorePath,
      forceDefault: profileId === "openai-codex:default"
    });

    existingAliases.add(alias);
    existingProfiles.add(profileId);
    created.push({ alias, profileId });
  }

  return created;
}

function nextAliasIndex(existingAliases: Set<string>): number {
  let max = 0;
  for (const alias of existingAliases) {
    const match = /^acct-(\d+)$/u.exec(alias);
    if (!match) {
      continue;
    }
    const value = Number(match[1]);
    if (Number.isFinite(value)) {
      max = Math.max(max, value);
    }
  }
  return max + 1;
}

function resolveNextAlias(existingAliases: Set<string>, start: number): string {
  let index = Math.max(1, start);
  while (existingAliases.has(`acct-${index}`)) {
    index += 1;
  }
  return `acct-${index}`;
}
