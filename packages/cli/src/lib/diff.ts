import { createTwoFilesPatch, structuredPatch } from "diff";
import type { PatchHunk, PostToolUseInput } from "@coldtea/abide-schema";
import { assertNever } from "@coldtea/abide-schema";
import { DIFF_TIMEOUT_MS, MAX_DIFF_INPUT_CHARS, MAX_STATE_CHARS } from "./constants.js";

export const renderHunks = (hunks: readonly PatchHunk[]): string =>
  hunks
    .map(
      (h) =>
        `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@\n${h.lines.join("\n")}`,
    )
    .join("\n");

/** Undefined when the diff would take longer than a hook may spend on it, or the inputs are too big to try. */
const hunksBetween = (
  before: string,
  after: string,
  timeoutMs = DIFF_TIMEOUT_MS,
): PatchHunk[] | undefined => {
  if (timeoutMs <= 0 || before.length + after.length > MAX_DIFF_INPUT_CHARS) return undefined;
  const patch = structuredPatch("a", "b", before, after, undefined, undefined, {
    context: 3,
    timeout: timeoutMs,
  });
  return patch?.hunks.map((h) => ({
    oldStart: h.oldStart,
    oldLines: h.oldLines,
    newStart: h.newStart,
    newLines: h.newLines,
    lines: h.lines,
  }));
};

const allAdded = (content: string): string => {
  const lines = content.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return `@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => `+${l}`).join("\n")}`;
};

export type EditHunk = { filePath: string; text: string; isNewFile: boolean };

const synthesized = (
  before: string,
  after: string,
  timeoutMs = DIFF_TIMEOUT_MS,
): string | undefined => {
  const hunks = hunksBetween(before, after, timeoutMs);
  return hunks === undefined ? undefined : renderHunks(hunks);
};

/** Time left on a budget that several diffs share. */
export const remainingMs = (deadline: number): number => Math.floor(deadline - performance.now());

/**
 * The hunk for one PostToolUse payload. Prefers the host's own patch and
 * synthesizes otherwise. Undefined when a synthesized diff could not be
 * computed within the time a hook may spend on it; the caller skips the check
 * and says so rather than holding the agent.
 */
export const hunkFromPostToolUse = (input: PostToolUseInput): EditHunk | undefined => {
  const hostPatch = input.tool_response?.structuredPatch;
  const fromHost = hostPatch && hostPatch.length > 0 ? renderHunks(hostPatch) : undefined;
  const filePath = input.tool_input.file_path;
  switch (input.tool_name) {
    case "Edit": {
      const text =
        fromHost ?? synthesized(input.tool_input.old_string, input.tool_input.new_string);
      return text === undefined ? undefined : { filePath, text, isNewFile: false };
    }
    case "Write": {
      const original = input.tool_response?.originalFile;
      if (original === null || original === undefined) {
        if (input.tool_input.content.length > MAX_DIFF_INPUT_CHARS) return undefined;
        return { filePath, text: allAdded(input.tool_input.content), isNewFile: true };
      }
      const text = fromHost ?? synthesized(original, input.tool_input.content);
      return text === undefined ? undefined : { filePath, text, isNewFile: false };
    }
    case "MultiEdit": {
      if (fromHost !== undefined) return { filePath, text: fromHost, isNewFile: false };
      // One budget for every part: each on its own could pass while together they hold the hook.
      const deadline = performance.now() + DIFF_TIMEOUT_MS;
      const parts: string[] = [];
      for (const edit of input.tool_input.edits) {
        const part = synthesized(edit.old_string, edit.new_string, remainingMs(deadline));
        if (part === undefined) return undefined;
        parts.push(part);
      }
      return { filePath, text: parts.join("\n"), isNewFile: false };
    }
    default:
      return assertNever(input);
  }
};

/** Undefined when the diff could not be computed within the time a hook may spend on it. */
export const unifiedDiff = (
  relativePath: string,
  before: string,
  after: string,
  timeoutMs = DIFF_TIMEOUT_MS,
): string | undefined =>
  timeoutMs <= 0 || before.length + after.length > MAX_DIFF_INPUT_CHARS
    ? undefined
    : createTwoFilesPatch(
        `a/${relativePath}`,
        `b/${relativePath}`,
        before,
        after,
        undefined,
        undefined,
        {
          context: 3,
          timeout: timeoutMs,
        },
      );

export const addedLines = (hunkText: string): string[] =>
  hunkText
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .map((l) => l.slice(1));

export const changedLineCount = (hunkText: string): number =>
  hunkText.split("\n").filter((l) => /^[+-](?![+-]{2})/.test(l)).length;

export const boundState = (
  text: string,
  max = MAX_STATE_CHARS,
): { text: string; truncated: boolean } =>
  text.length <= max
    ? { text, truncated: false }
    : { text: `${text.slice(0, max)}\n[abide: diff cut at ${max} characters]`, truncated: true };
