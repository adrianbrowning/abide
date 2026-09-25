import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { assertNever } from "@coldtea/abide-schema";
import { packageRoot } from "./packageRoot.js";

/** Hosts that load abide as an in-process module rather than running hook commands. */
export type PluginHost = "opencode" | "omp";

export const pluginMarker = (host: PluginHost): string => {
  switch (host) {
    case "opencode":
      return "abide-opencode-plugin";
    case "omp":
      return "abide-omp-extension";
    default:
      return assertNever(host);
  }
};

/**
 * The installed file only re-exports the module shipped in the package, so an
 * upgrade needs no reinstall. Both hosts discover `*.js` and `*.ts` only, so
 * the installed file is `.js` whatever the package uses.
 */
export const installPlugin = (host: PluginHost, target: string): void => {
  const source = pathToFileURL(path.join(packageRoot(), host, "abide.mjs")).href;
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(
    target,
    [
      `// ${pluginMarker(host)}: written by \`abide init ${host}\`; remove with \`abide uninstall ${host}\`.`,
      `export { default } from ${JSON.stringify(source)};`,
      "",
    ].join("\n"),
  );
};

export const uninstallPlugin = (host: PluginHost, target: string): boolean => {
  if (!existsSync(target)) return false;
  let text: string;
  try {
    text = readFileSync(target, "utf8");
  } catch {
    return false;
  }
  if (!text.includes(pluginMarker(host))) return false;
  rmSync(target);
  return true;
};
