import { describe, expect, it } from "vitest";
import { execa } from "execa";

describe("cli help", () => {
  it("shows setup, status, doctor, repair, restore, and account commands", async () => {
    const { stdout } = await execa("node", ["--import", "tsx", "src/cli/main.ts", "--help"]);
    expect(stdout).toContain("setup");
    expect(stdout).toContain("status");
    expect(stdout).toContain("doctor");
    expect(stdout).toContain("repair");
    expect(stdout).toContain("restore");
    expect(stdout).toContain("account");
  });
});
