import { describe, expect, it } from "vitest";
import { classifyCodexFailure } from "../../src/classifier/codex_error_classifier.js";

describe("codex error classifier", () => {
  it("maps ChatGPT usage limit to rate_limit", () => {
    expect(classifyCodexFailure("You have hit your ChatGPT usage limit (team plan)")).toMatchObject({
      reason: "rate_limit",
      action: "cooldown"
    });
  });

  it("maps deactivated_workspace to auth_permanent", () => {
    expect(classifyCodexFailure('{"detail":{"code":"deactivated_workspace"}}')).toMatchObject({
      reason: "auth_permanent",
      action: "disable"
    });
  });

  it("maps invalid_grant to auth_permanent", () => {
    expect(classifyCodexFailure("invalid_grant")).toMatchObject({
      reason: "auth_permanent",
      action: "disable"
    });
  });
});
