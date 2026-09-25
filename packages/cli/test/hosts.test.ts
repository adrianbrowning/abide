import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  detectHosts,
  installHost,
  installTarget,
  parseHost,
  uninstallHost,
} from "../src/lib/hosts.js";
import { pluginMarker } from "../src/lib/hostPlugin.js";

let home: string;
let root: string;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "abide-home-"));
  root = mkdtempSync(path.join(tmpdir(), "abide-repo-"));
  process.env.ABIDE_HOME_DIR = home;
  process.env.PATH = "/nonexistent";
});

afterEach(() => {
  delete process.env.ABIDE_HOME_DIR;
});

describe("hosts", () => {
  it("names the agents it knows and refuses the rest", () => {
    expect(parseHost("Codex")).toBe("codex");
    expect(() => parseHost("grok")).toThrow(/not one of/);
  });

  it("detects a host by its config directory", () => {
    expect(detectHosts()).toEqual([]);
    mkdirSync(path.join(home, ".codex"));
    mkdirSync(path.join(home, ".config", "opencode"), { recursive: true });
    mkdirSync(path.join(home, ".omp"));
    expect(detectHosts()).toEqual(["codex", "opencode", "omp"]);
  });

  it("writes Claude and Codex hooks into their own files and removes only its own entries", () => {
    for (const host of ["claude", "codex"] as const) {
      const target = installTarget(host, root, false);
      installHost(host, root, false);
      const json = JSON.parse(readFileSync(target, "utf8"));
      expect(Object.keys(json.hooks).sort()).toEqual([
        "PostToolUse",
        "SessionStart",
        "Stop",
        "UserPromptSubmit",
      ]);
      expect(json.hooks.PostToolUse[0].matcher).toBe("Edit|Write|MultiEdit|apply_patch");
      expect(uninstallHost(host, root, false)).toBe(4);
      expect(uninstallHost(host, root, false)).toBe(0);
    }
    expect(installTarget("codex", root, true)).toBe(path.join(root, ".codex", "hooks.json"));
  });

  it("installs OpenCode and oh-my-pi as a module file it can recognise, and leaves a stranger's file alone", () => {
    const targets = {
      opencode: path.join(home, ".config", "opencode", "plugins", "abide.js"),
      omp: path.join(home, ".omp", "agent", "extensions", "abide.js"),
    };
    for (const host of ["opencode", "omp"] as const) {
      const target = installTarget(host, root, false);
      expect(target).toBe(targets[host]);
      installHost(host, root, false);
      const text = readFileSync(target, "utf8");
      expect(text).toContain(pluginMarker(host));
      expect(text).toMatch(
        new RegExp(`export \\{ default \\} from "file://.*/${host}/abide\\.mjs"`),
      );
      expect(uninstallHost(host, root, false)).toBe(1);
      expect(existsSync(target)).toBe(false);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, "export default async () => ({});\n");
      expect(uninstallHost(host, root, false)).toBe(0);
      expect(existsSync(target)).toBe(true);
    }
    expect(installTarget("omp", root, true)).toBe(
      path.join(root, ".omp", "extensions", "abide.js"),
    );
  });
});
