import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { SESSION_STATE_MAX_AGE_MS } from "./constants.js";
import { sessionsDir } from "./paths.js";

/**
 * Turn state on disk, one directory per session and prompt, written as
 * first-write-wins files. Hooks for parallel tool calls run at the same time,
 * so nothing here is read, changed and written back: a file's start-of-turn
 * content is created once with `wx`, and a counter is the number of files
 * with its prefix, each created with `wx`.
 */

const safe = (part: string): string => part.replace(/[^A-Za-z0-9_-]/g, "_");
const shortHash = (value: string): string =>
  createHash("sha256").update(value).digest("hex").slice(0, 24);

export const NO_PROMPT_TURN = "turn";

export const turnDir = (sessionId: string, promptId: string | undefined): string =>
  path.join(sessionsDir(), safe(sessionId), safe(promptId ?? NO_PROMPT_TURN));

const fileStartSchema = z.object({ path: z.string(), original: z.string().nullable() });
export type FileStart = z.infer<typeof fileStartSchema>;

const createOnce = (file: string, contents: string): boolean => {
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, contents, { flag: "wx" });
    return true;
  } catch {
    return false;
  }
};

const countWithPrefix = (dir: string, prefix: string): number => {
  try {
    return readdirSync(dir).filter((name) => name.startsWith(prefix)).length;
  } catch {
    return 0;
  }
};

/** Bumps a counter by creating the next numbered file. Two hooks racing both land: each retries past the other's number. */
const increment = (dir: string, prefix: string): number => {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const next = countWithPrefix(dir, prefix) + 1;
    if (createOnce(path.join(dir, `${prefix}${next}`), "")) return next;
  }
  return countWithPrefix(dir, prefix);
};

/** The content a file had when this turn first touched it. Only the first record counts. */
export const recordFileStart = (
  dir: string,
  absolutePath: string,
  original: string | null,
): void => {
  const record: FileStart = { path: absolutePath, original };
  createOnce(path.join(dir, "files", `${shortHash(absolutePath)}.json`), JSON.stringify(record));
};

export const readFileStarts = (dir: string): FileStart[] => {
  const filesDir = path.join(dir, "files");
  let names: string[];
  try {
    names = readdirSync(filesDir);
  } catch {
    return [];
  }
  const starts: FileStart[] = [];
  for (const name of names) {
    try {
      const parsed = fileStartSchema.safeParse(
        JSON.parse(readFileSync(path.join(filesDir, name), "utf8")),
      );
      if (parsed.success) starts.push(parsed.data);
    } catch {
      // a record still being written by the other hook
    }
  }
  return starts;
};

const blockPrefix = (key: string): string => `${shortHash(key)}.`;

export const blockCount = (dir: string, key: string): number =>
  countWithPrefix(path.join(dir, "blocks"), blockPrefix(key));

export const incrementBlock = (dir: string, key: string): number =>
  increment(path.join(dir, "blocks"), blockPrefix(key));

export const stopCheckCount = (dir: string): number =>
  countWithPrefix(path.join(dir, "stops"), "stop.");

export const incrementStopChecks = (dir: string): number =>
  increment(path.join(dir, "stops"), "stop.");

/** The git tree the working tree was at when the turn began, when a turn-start hook recorded one. */
export const writeBaseline = (dir: string, tree: string): void => {
  createOnce(path.join(dir, "baseline"), tree);
};

export const readBaseline = (dir: string): string | undefined => {
  try {
    const tree = readFileSync(path.join(dir, "baseline"), "utf8").trim();
    return /^[0-9a-f]{40,64}$/.test(tree) ? tree : undefined;
  } catch {
    return undefined;
  }
};

/**
 * What became of the turn-start snapshot. Absent on a repository without git,
 * where the per-file fallback is the documented mode. `pending` means the
 * hook died before it could say, which for the Stop check is the same as
 * failed: the turn cannot be read back whole.
 */
export type BaselineStatus = "pending" | "ok" | "failed";

const statusFile = (dir: string): string => path.join(dir, "baseline-status");

export const markBaseline = (dir: string, status: BaselineStatus): void => {
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(statusFile(dir), status);
  } catch {
    // nothing to record on; Stop will see no status and take the fallback
  }
};

export const readBaselineStatus = (dir: string): BaselineStatus | undefined => {
  try {
    const raw = readFileSync(statusFile(dir), "utf8").trim();
    return raw === "ok" || raw === "pending" || raw === "failed" ? raw : undefined;
  } catch {
    return undefined;
  }
};

export const hasTurnState = (dir: string): boolean =>
  readFileStarts(dir).length > 0 ||
  readBaseline(dir) !== undefined ||
  readBaselineStatus(dir) !== undefined;

export const clearTurn = (dir: string): void => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // already gone
  }
};

export const pruneOldTurns = (now = Date.now()): void => {
  try {
    for (const name of readdirSync(sessionsDir())) {
      const file = path.join(sessionsDir(), name);
      if (now - statSync(file).mtimeMs > SESSION_STATE_MAX_AGE_MS)
        rmSync(file, { recursive: true, force: true });
    }
  } catch {
    // no sessions dir yet
  }
};
