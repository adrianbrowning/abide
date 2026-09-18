import path from "node:path";
import { z } from "zod";
import type { HookOutput } from "@coldtea/abide-schema";
import { TURN_START_TIMEOUT_MS } from "../lib/constants.js";
import { isGitRepo, snapshotTree } from "../lib/git.js";
import { findRepoRoot } from "../lib/paths.js";
import { clearTurn, markBaseline, turnDir, writeBaseline } from "../lib/session.js";

const turnStartInputSchema = z.object({
  session_id: z.string(),
  prompt_id: z.string().optional(),
  cwd: z.string(),
  hook_event_name: z.literal("UserPromptSubmit"),
});

/**
 * The turn is about to begin: remember what the working tree looks like now,
 * so the Stop check can diff the whole turn, whichever tool made the changes.
 * Prints nothing: on this event plain stdout would become context.
 */
export const handleTurnStart = async (raw: unknown): Promise<HookOutput> => {
  const parsed = turnStartInputSchema.safeParse(raw);
  if (!parsed.success) return { kind: "silent" };
  const input = parsed.data;
  const root = findRepoRoot(input.cwd);
  const dir = turnDir(input.session_id, input.prompt_id);
  // Without a prompt id every turn shares one directory, so the last turn's
  // records go before this one's start.
  if (input.prompt_id === undefined) clearTurn(dir);
  if (!isGitRepo(root)) return { kind: "silent" };
  // Written before the attempt: a hook that dies mid-snapshot leaves "pending"
  // behind, and the Stop check reads that as a turn it cannot see whole.
  markBaseline(dir, "pending");
  const tree = snapshotTree(root, path.join(dir, "index"), TURN_START_TIMEOUT_MS);
  if (tree === undefined) {
    markBaseline(dir, "failed");
    return { kind: "silent" };
  }
  writeBaseline(dir, tree);
  markBaseline(dir, "ok");
  return { kind: "silent" };
};
