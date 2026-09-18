import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { AbideError } from "@coldtea/abide-schema";
import { resolveCredentials } from "../lib/credentials.js";
import { hookScriptPath } from "../lib/packageRoot.js";
import { abideDir, findRepoRoot, homeDir, rubricPath } from "../lib/paths.js";
import { readRubric } from "../lib/rubricFile.js";
import { hookSpecs, installHooks } from "../lib/settings.js";
import { discoverGlobalSources, discoverProjectSources } from "../lib/sources.js";
import type { Step } from "../ui/components/Checklist.js";
import { showStatic } from "../ui/render.js";
import { InitView } from "../ui/views/InitView.js";

export const settingsTarget = (
  root: string,
  project: boolean,
  explicit: string | undefined,
): string =>
  explicit ??
  (project
    ? path.join(root, ".claude", "settings.json")
    : path.join(homeDir(), ".claude", "settings.json"));

const selfTest = (script: string, root: string): boolean => {
  const payload = JSON.stringify({
    session_id: "abide-init-selftest",
    cwd: root,
    hook_event_name: "SessionStart",
    source: "startup",
  });
  const result = spawnSync("node", [script, "session-start"], {
    input: payload,
    encoding: "utf8",
    env: { ...process.env, ABIDE_DEBUG: "" },
    timeout: 15_000,
  });
  return result.status === 0;
};

export const runInit = async (argv: string[]): Promise<number> => {
  const { values } = parseArgs({
    args: argv,
    options: { project: { type: "boolean", default: false }, settings: { type: "string" } },
  });
  const root = findRepoRoot(process.cwd());

  const creds = resolveCredentials(root);
  if (creds.kind === "none") {
    await showStatic(InitView({ data: { kind: "no-key", root } }));
    return 1;
  }

  const project = discoverProjectSources(root);
  const global = discoverGlobalSources();
  if (project.length === 0 && global.length === 0) {
    await showStatic(InitView({ data: { kind: "no-sources", root } }));
    return 1;
  }

  const script = hookScriptPath();
  const target = settingsTarget(root, values.project, values.settings);
  const steps: Step[] = [
    {
      ok: true,
      text: `${creds.kind === "typesafe" ? "TypeSafe" : "Vercel AI Gateway"} key found in ${creds.from}`,
    },
  ];
  steps.push({
    ok: true,
    text: `${project.length + global.length} instruction ${project.length + global.length === 1 ? "file" : "files"} found`,
  });
  installHooks(target, hookSpecs(script));
  steps.push({
    ok: true,
    text: "hooks written: SessionStart, UserPromptSubmit, PostToolUse, Stop",
    detail: target,
  });
  mkdirSync(abideDir(root), { recursive: true });
  writeFileSync(path.join(abideDir(root), ".gitignore"), "events.jsonl\ncompile-skill.md\n");
  const ok = selfTest(script, root);
  if (!ok)
    throw new AbideError(
      "SETTINGS_INVALID",
      `the hook at ${script} did not run cleanly; nothing was enabled`,
    );
  steps.push({ ok: true, text: "hook self-test passed" });

  const rubric = readRubric(rubricPath(root));
  await showStatic(
    InitView({
      data: {
        kind: "installed",
        root,
        steps,
        sources: [
          ...project.map((c) => ({ path: c.path, scope: c.scope, global: false })),
          ...global.map((c) => ({ path: c.path, scope: c.scope, global: true })),
        ],
        rubric:
          rubric.kind === "ok" ? { path: rubric.path, rules: rubric.rubric.rules.length } : null,
      },
    }),
  );
  return 0;
};
