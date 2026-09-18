import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Directory of the installed @coldtea/abide package (the one holding package.json). */
export const packageRoot = (): string => {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const candidate = path.join(dir, "package.json");
    if (existsSync(candidate)) {
      try {
        const name: unknown = JSON.parse(readFileSync(candidate, "utf8")).name;
        if (name === "@coldtea/abide") return dir;
      } catch {
        // keep walking
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return dir;
    dir = parent;
  }
};

export const hookScriptPath = (): string => path.join(packageRoot(), "dist", "abide-hook.js");
export const binScriptPath = (): string => path.join(packageRoot(), "dist", "bin.js");
export const compileSkillPath = (): string =>
  path.join(packageRoot(), "skills", "abide-compile", "SKILL.md");

/** Copies the packaged skill into the repo so the agent can read it without leaving the project. */
export const placeCompileSkill = (root: string): string => {
  const target = path.join(root, ".abide", "compile-skill.md");
  try {
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(compileSkillPath(), target);
  } catch {
    // fall back to the packaged copy; interactive sessions can read it after a prompt
    return compileSkillPath();
  }
  return target;
};
