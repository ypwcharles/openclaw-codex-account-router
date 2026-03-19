export type OpenClawExecResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type CodexPoolRunResult = {
  poolExhausted: boolean;
  usedProfileIds: string[];
  result?: OpenClawExecResult;
  lastError?: string;
};
