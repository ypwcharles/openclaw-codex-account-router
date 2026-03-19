import { execa } from "execa";
import type { OpenClawExecResult } from "./result.js";

export async function execOpenClawCommand(command: string, args: string[]): Promise<OpenClawExecResult> {
  const result = await execa(command, args, {
    reject: false,
    all: false
  });
  if (result.exitCode !== 0) {
    const message = [result.stderr, result.stdout].filter(Boolean).join("\n") || command;
    throw new Error(message);
  }
  return {
    exitCode: result.exitCode ?? 0,
    stdout: result.stdout,
    stderr: result.stderr
  };
}
