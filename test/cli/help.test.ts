import { describe, expect, it } from "vitest";
import { execa } from "execa";

describe("cli help", () => {
  it("shows the status and run commands", async () => {
    const { stdout } = await execa("node", ["--import", "tsx", "src/cli/main.ts", "--help"]);
    expect(stdout).toContain("status");
    expect(stdout).toContain("run");
  });
});
