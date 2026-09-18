import { readFileSync } from "node:fs";
import {
  createBlockKey,
  isAbideError,
  postToolUseInputSchema,
  type HookOutput,
  type PostToolUseInput,
  type Rule,
  type Verdict,
} from "@coldtea/abide-schema";
import { runCheck } from "../lib/checkRunner.js";
import { EDIT_CHECK_TIMEOUT_MS, MAX_BLOCKS_PER_RULE_PER_TURN } from "../lib/constants.js";
import { boundState, hunkFromPostToolUse } from "../lib/diff.js";
import { appendEvent } from "../lib/events.js";
import { hasApiKey } from "../lib/jev.js";
import { loadRules } from "../lib/loadRules.js";
import { debug } from "../lib/output.js";
import { findRepoRoot, isAbideOwned, relativeToRoot } from "../lib/paths.js";
import { flagNotice, repairReason } from "../lib/reason.js";
import { blockCount, incrementBlock, recordFileStart, turnDir } from "../lib/session.js";
import { lastUserPrompt } from "../lib/transcript.js";

/** The file's content when this turn first touched it, for a Stop check without a git baseline. */
const contentBeforeEdit = (input: PostToolUseInput): string | null => {
  const original = input.tool_response?.originalFile;
  if (original !== undefined) return original;
  switch (input.tool_name) {
    case "Write":
      return null;
    case "Edit": {
      try {
        const now = readFileSync(input.tool_input.file_path, "utf8");
        return now.replace(input.tool_input.new_string, input.tool_input.old_string);
      } catch {
        return null;
      }
    }
    case "MultiEdit": {
      try {
        let now = readFileSync(input.tool_input.file_path, "utf8");
        for (const edit of [...input.tool_input.edits].reverse()) {
          now = now.replace(edit.new_string, edit.old_string);
        }
        return now;
      } catch {
        return null;
      }
    }
    default:
      return null;
  }
};

type Pair = { rule: Rule; verdict: Verdict };

export const handlePostToolUse = async (raw: unknown): Promise<HookOutput> => {
  const parsed = postToolUseInputSchema.safeParse(raw);
  if (!parsed.success) return { kind: "silent" };
  const input = parsed.data;
  const started = performance.now();
  const at = new Date().toISOString();
  const root = findRepoRoot(input.tool_input.file_path);
  const relative = relativeToRoot(root, input.tool_input.file_path);
  if (isAbideOwned(relative)) return { kind: "silent" };

  const turn = turnDir(input.session_id, input.prompt_id);
  recordFileStart(turn, input.tool_input.file_path, contentBeforeEdit(input));

  const loaded = loadRules(root);
  for (const problem of loaded.problems) debug(problem);
  if (loaded.rules.length === 0) return { kind: "silent" };

  const hunk = hunkFromPostToolUse(input);
  if (hunk === undefined) {
    appendEvent(root, {
      kind: "skip",
      at,
      phase: "edit",
      sessionId: input.session_id,
      reason: "diff too large to compute in time",
      files: [relative],
    });
    return { kind: "silent" };
  }
  const { text: diff } = boundState(hunk.text);
  if (diff.trim() === "") return { kind: "silent" };

  if (!hasApiKey()) {
    appendEvent(root, {
      kind: "skip",
      at,
      phase: "edit",
      sessionId: input.session_id,
      reason: "no api key",
      files: [relative],
    });
  }

  let outcome;
  try {
    outcome = await runCheck({
      phase: "edit",
      fileDiffs: [{ file: relative, text: diff }],
      task: lastUserPrompt(input.transcript_path),
      rules: loaded.rules,
      thresholds: loaded.thresholds,
      timeoutMs: EDIT_CHECK_TIMEOUT_MS,
    });
  } catch (error) {
    appendEvent(root, {
      kind: "error",
      at,
      phase: "edit",
      sessionId: input.session_id,
      code: isAbideError(error) ? error.code : "CHECK_FAILED",
      message: error instanceof Error ? error.message : String(error),
      latencyMs: Math.round(performance.now() - started),
    });
    return { kind: "silent" };
  }

  const byId = new Map(loaded.rules.map((r) => [r.id, r]));
  const pairs = (band: Verdict["band"]): Pair[] =>
    outcome.verdicts.flatMap((verdict) => {
      const rule = byId.get(verdict.ruleId);
      return rule !== undefined && verdict.band === band ? [{ rule, verdict }] : [];
    });

  const actPairs = pairs("act");
  const acting = actPairs.filter(
    ({ rule }) =>
      blockCount(turn, createBlockKey(rule.id, relative)) < MAX_BLOCKS_PER_RULE_PER_TURN,
  );
  for (const { rule } of acting) incrementBlock(turn, createBlockKey(rule.id, relative));
  const flagged = [...pairs("flag"), ...actPairs.filter((p) => !acting.includes(p))];

  appendEvent(root, {
    kind: "check",
    at,
    phase: "edit",
    sessionId: input.session_id,
    promptId: input.prompt_id,
    files: [relative],
    rules: outcome.modelRules.length,
    latencyMs: Math.round(performance.now() - started),
    modelLatencyMs: outcome.modelLatencyMs,
    usage: outcome.usage,
    verdicts: outcome.verdicts,
    blocked: acting.length > 0,
  });

  const systemMessage = flagged.length > 0 ? flagNotice("edit", flagged, [relative]) : undefined;
  if (acting.length > 0) {
    return {
      kind: "block",
      reason: repairReason("edit", acting, [relative]),
      ...(systemMessage === undefined ? {} : { systemMessage }),
    };
  }
  return systemMessage === undefined ? { kind: "silent" } : { kind: "notice", systemMessage };
};
