import path from "node:path";

export const PATH_BLOCK_BEGIN = "# >>> openclaw-router managed path >>>";
export const PATH_BLOCK_END = "# <<< openclaw-router managed path <<<";

export type ShellProfileSyntax = "posix" | "fish";

export type ShellProfile = {
  path: string;
  syntax: ShellProfileSyntax;
};

export function resolveShellProfile(
  shellPath: string | undefined,
  homeDir: string
): ShellProfile {
  const shellName = path.basename(shellPath ?? "").toLowerCase();
  if (shellName === "fish") {
    return {
      path: path.join(homeDir, ".config", "fish", "config.fish"),
      syntax: "fish"
    };
  }
  if (shellName === "zsh") {
    return {
      path: path.join(homeDir, ".zprofile"),
      syntax: "posix"
    };
  }
  if (shellName === "bash") {
    return {
      path: path.join(homeDir, ".bashrc"),
      syntax: "posix"
    };
  }
  return {
    path: path.join(homeDir, ".profile"),
    syntax: "posix"
  };
}

export function resolveShellProfileCandidates(
  shellPath: string | undefined,
  homeDir: string
): ShellProfile[] {
  const shellName = path.basename(shellPath ?? "").toLowerCase();
  if (shellName === "fish") {
    return [
      {
        path: path.join(homeDir, ".config", "fish", "config.fish"),
        syntax: "fish"
      }
    ];
  }
  if (shellName === "zsh") {
    return dedupeProfiles([
      {
        path: path.join(homeDir, ".zprofile"),
        syntax: "posix"
      },
      {
        path: path.join(homeDir, ".zshrc"),
        syntax: "posix"
      },
      {
        path: path.join(homeDir, ".profile"),
        syntax: "posix"
      }
    ]);
  }
  if (shellName === "bash") {
    return dedupeProfiles([
      {
        path: path.join(homeDir, ".bash_profile"),
        syntax: "posix"
      },
      {
        path: path.join(homeDir, ".bash_login"),
        syntax: "posix"
      },
      {
        path: path.join(homeDir, ".bashrc"),
        syntax: "posix"
      },
      {
        path: path.join(homeDir, ".profile"),
        syntax: "posix"
      }
    ]);
  }
  return dedupeProfiles([
    {
      path: path.join(homeDir, ".profile"),
      syntax: "posix"
    },
    {
      path: path.join(homeDir, ".zprofile"),
      syntax: "posix"
    },
    {
      path: path.join(homeDir, ".zshrc"),
      syntax: "posix"
    },
    {
      path: path.join(homeDir, ".bash_profile"),
      syntax: "posix"
    },
    {
      path: path.join(homeDir, ".bash_login"),
      syntax: "posix"
    },
    {
      path: path.join(homeDir, ".bashrc"),
      syntax: "posix"
    },
    {
      path: path.join(homeDir, ".config", "fish", "config.fish"),
      syntax: "fish"
    }
  ]);
}

export function renderPathBlock(
  syntax: ShellProfileSyntax,
  managedBinDir: string
): string | undefined {
  if (syntax === "posix") {
    return `${PATH_BLOCK_BEGIN}\nexport PATH="${managedBinDir}:$PATH"\n${PATH_BLOCK_END}`;
  }
  if (syntax === "fish") {
    return `${PATH_BLOCK_BEGIN}\nset -gx PATH "${managedBinDir}" $PATH\n${PATH_BLOCK_END}`;
  }
  return undefined;
}

export function upsertManagedPathBlock(existing: string, block: string): string {
  const blockRegex = new RegExp(
    `${escapeRegex(PATH_BLOCK_BEGIN)}[\\s\\S]*?${escapeRegex(PATH_BLOCK_END)}\\n?`,
    "u"
  );
  if (blockRegex.test(existing)) {
    return existing.replace(blockRegex, `${block}\n`);
  }
  const prefix = existing.endsWith("\n") || existing.length === 0 ? existing : `${existing}\n`;
  return `${prefix}${block}\n`;
}

export function hasManagedPathBlock(
  existing: string,
  syntax: ShellProfileSyntax,
  managedBinDir: string
): boolean {
  const expectedBlock = renderPathBlock(syntax, managedBinDir);
  if (!expectedBlock) {
    return false;
  }
  return normalizeNewlines(existing).includes(normalizeNewlines(expectedBlock));
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

function dedupeProfiles(profiles: ShellProfile[]): ShellProfile[] {
  const seen = new Set<string>();
  const deduped: ShellProfile[] = [];
  for (const profile of profiles) {
    if (seen.has(profile.path)) {
      continue;
    }
    seen.add(profile.path);
    deduped.push(profile);
  }
  return deduped;
}
