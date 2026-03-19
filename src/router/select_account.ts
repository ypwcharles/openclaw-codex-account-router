import type { RouterAccount } from "../account_store/types.js";

export function selectEligibleAccounts(accounts: RouterAccount[], now: Date): RouterAccount[] {
  const nowMs = now.getTime();
  const normalized = accounts
    .filter((account) => account.enabled)
    .map((account) => normalizeCooldown(account, nowMs))
    .filter((account) => account.status !== "disabled")
    .filter((account) => account.status !== "cooldown")
    .sort((a, b) => a.priority - b.priority);

  return normalized;
}

function normalizeCooldown(account: RouterAccount, nowMs: number): RouterAccount {
  if (account.status !== "cooldown") {
    return account;
  }
  if (!account.cooldownUntil) {
    return account;
  }
  const cooldownMs = Date.parse(account.cooldownUntil);
  if (!Number.isFinite(cooldownMs) || cooldownMs > nowMs) {
    return account;
  }
  return {
    ...account,
    status: "healthy",
    cooldownUntil: undefined
  };
}
