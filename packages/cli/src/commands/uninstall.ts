import { parseArgs } from "node:util";
import { findRepoRoot } from "../lib/paths.js";
import { uninstallHooks } from "../lib/settings.js";
import { Callout } from "../ui/components/Callout.js";
import { showStatic } from "../ui/render.js";
import { settingsTarget } from "./init.js";

export const runUninstall = async (argv: string[]): Promise<number> => {
  const { values } = parseArgs({
    args: argv,
    options: { project: { type: "boolean", default: false }, settings: { type: "string" } },
  });
  const target = settingsTarget(findRepoRoot(process.cwd()), values.project, values.settings);
  const removed = uninstallHooks(target);
  await showStatic(
    removed === 0
      ? Callout({ tone: "muted", title: `No abide hooks in ${target}` })
      : Callout({
          tone: "ok",
          title: `Removed ${removed} abide hook ${removed === 1 ? "entry" : "entries"} from ${target}. Your rubric files are untouched.`,
        }),
  );
  return 0;
};
