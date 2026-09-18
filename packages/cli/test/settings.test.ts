import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  hookSpecs,
  installHooks,
  installedHookEvents,
  uninstallHooks,
} from "../src/lib/settings.js";

describe("settings", () => {
  it("installs four hooks, keeps others, and is idempotent", () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "abide-settings-")), "settings.json");
    writeFileSync(
      file,
      JSON.stringify({
        model: "x",
        hooks: {
          PostToolUse: [{ matcher: "*", hooks: [{ type: "command", command: "other.sh" }] }],
        },
      }),
    );
    const specs = hookSpecs("/pkg/dist/abide-hook.js");
    installHooks(file, specs);
    installHooks(file, specs);
    const json = JSON.parse(readFileSync(file, "utf8"));
    expect(json.model).toBe("x");
    expect(json.hooks.PostToolUse).toHaveLength(2);
    expect(json.hooks.PostToolUse[0].hooks[0].command).toBe("other.sh");
    expect(json.hooks.PostToolUse[1].matcher).toBe("Edit|Write|MultiEdit");
    expect(json.hooks.PostToolUse[1].hooks[0].command).toContain("abide-hook.js");
    expect(json.hooks.Stop).toHaveLength(1);
    expect(json.hooks.UserPromptSubmit).toHaveLength(1);
    expect(installedHookEvents(file)).toEqual([
      "SessionStart",
      "UserPromptSubmit",
      "PostToolUse",
      "Stop",
    ]);
    expect(uninstallHooks(file)).toBe(4);
    const after = JSON.parse(readFileSync(file, "utf8"));
    expect(after.hooks.PostToolUse).toHaveLength(1);
    expect(after.hooks.Stop).toBeUndefined();
  });

  it("refuses a settings file it cannot parse", () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "abide-settings-")), "settings.json");
    writeFileSync(file, "{ not json");
    expect(() => installHooks(file, hookSpecs("/x/abide-hook.js"))).toThrow(/not a settings file/);
  });
});
