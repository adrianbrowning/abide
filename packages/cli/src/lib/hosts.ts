import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { AbideError, assertNever, HOSTS, hostSchema, type Host } from "@coldtea/abide-schema";
import { installPlugin, uninstallPlugin } from "./hostPlugin.js";
import { hookScriptPath } from "./packageRoot.js";
import { homeDir } from "./paths.js";
import { hookSpecs, installHooks, uninstallHooks } from "./settings.js";

export const hostLabel = (host: Host): string => {
  switch (host) {
    case "claude":
      return "Claude Code";
    case "codex":
      return "Codex";
    case "opencode":
      return "OpenCode";
    case "omp":
      return "oh-my-pi";
    default:
      return assertNever(host);
  }
};

export const parseHost = (name: string): Host => {
  const parsed = hostSchema.safeParse(name.toLowerCase());
  if (!parsed.success)
    throw new AbideError("HOST_UNKNOWN", `"${name}" is not one of ${HOSTS.join(", ")}`);
  return parsed.data;
};

const onPath = (bin: string): boolean =>
  spawnSync("which", [bin], { encoding: "utf8" }).status === 0;

export const hostPresent = (host: Host): boolean => {
  switch (host) {
    case "claude":
      return existsSync(path.join(homeDir(), ".claude")) || onPath("claude");
    case "codex":
      return existsSync(path.join(homeDir(), ".codex")) || onPath("codex");
    case "opencode":
      return existsSync(path.join(homeDir(), ".config", "opencode")) || onPath("opencode");
    case "omp":
      return existsSync(path.join(homeDir(), ".omp")) || onPath("omp");
    default:
      return assertNever(host);
  }
};

export const detectHosts = (): Host[] => HOSTS.filter(hostPresent);

/**
 * Where abide's entries live for a host. Claude Code and Codex read the same
 * hooks JSON shape from different files; OpenCode and oh-my-pi load a module
 * from a directory they scan, so no config file is edited there.
 */
export const installTarget = (host: Host, root: string, project: boolean): string => {
  switch (host) {
    case "claude":
      return project
        ? path.join(root, ".claude", "settings.json")
        : path.join(homeDir(), ".claude", "settings.json");
    case "codex":
      return project
        ? path.join(root, ".codex", "hooks.json")
        : path.join(homeDir(), ".codex", "hooks.json");
    case "opencode":
      return project
        ? path.join(root, ".opencode", "plugins", "abide.js")
        : path.join(homeDir(), ".config", "opencode", "plugins", "abide.js");
    case "omp":
      return project
        ? path.join(root, ".omp", "extensions", "abide.js")
        : path.join(homeDir(), ".omp", "agent", "extensions", "abide.js");
    default:
      return assertNever(host);
  }
};

export type Installed = { host: Host; target: string; what: string; afterwards?: string };

export const installHost = (host: Host, root: string, project: boolean): Installed => {
  const target = installTarget(host, root, project);
  switch (host) {
    case "claude":
      installHooks(target, hookSpecs(hookScriptPath()));
      return {
        host,
        target,
        what: "hooks written: SessionStart, UserPromptSubmit, PostToolUse, Stop",
      };
    case "codex":
      installHooks(target, hookSpecs(hookScriptPath()));
      return {
        host,
        target,
        what: "hooks written: SessionStart, UserPromptSubmit, PostToolUse, Stop",
        afterwards:
          "Codex trusts new hooks once: start codex, type /hooks, accept the four abide entries.",
      };
    case "opencode":
      installPlugin(host, target);
      return { host, target, what: "plugin written; OpenCode loads it at the next start" };
    case "omp":
      installPlugin(host, target);
      return { host, target, what: "extension written; oh-my-pi loads it at the next start" };
    default:
      return assertNever(host);
  }
};

export const uninstallHost = (host: Host, root: string, project: boolean): number => {
  const target = installTarget(host, root, project);
  switch (host) {
    case "claude":
    case "codex":
      return uninstallHooks(target);
    case "opencode":
    case "omp":
      return uninstallPlugin(host, target) ? 1 : 0;
    default:
      return assertNever(host);
  }
};
