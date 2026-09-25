// Abide for oh-my-pi.
//
// oh-my-pi runs extensions inside its own process, so this module turns its
// events into the payloads the abide hook script already reads, runs that
// script, and hands the answer back the way oh-my-pi carries it to the model:
// an edit's repair request is appended to the tool result, and a turn's repair
// request is the session_stop block reason, which oh-my-pi runs as a
// continuation. The checks, the rubric and the messages are the same as on
// every other host.
//
// Nothing here may throw into oh-my-pi or touch the disk before a tool runs.
// `write` results carry no earlier content, so a write is checked at the end
// of the turn, which diffs the whole working tree. Every handler catches, and
// the script has its own deadline.

import { runHook } from "../plugins/run-hook.mjs";

/**
 * Before and after for every file an edit result carries both for. A pruned
 * snapshot, a delete, or an update without its old text is left to the
 * end-of-turn check, which diffs the whole working tree.
 */
const editedFiles = (details) => {
  const entries = Array.isArray(details?.perFileResults)
    ? details.perFileResults
    : details
      ? [details]
      : [];
  return entries.flatMap((e) => {
    if (typeof e?.path !== "string" || typeof e.newText !== "string" || e.snapshotsPruned)
      return [];
    if (typeof e.oldText === "string")
      return [{ file: e.path, before: e.oldText, after: e.newText }];
    return e.op === "create" ? [{ file: e.path, before: null, after: e.newText }] : [];
  });
};

/** Every change arrives as a whole-file write, whatever edit syntax produced it. */
const writePayload = ({ file, before, after }) => ({
  tool_name: "Write",
  tool_input: { file_path: file, content: after },
  tool_response: { filePath: file, originalFile: before },
});

const sessionIdOf = (ctx) => {
  try {
    const id = ctx?.sessionManager?.getSessionId?.();
    return typeof id === "string" && id !== "" ? id : undefined;
  } catch {
    return undefined;
  }
};

const notify = (ctx, message) => {
  if (typeof message !== "string" || message === "") return;
  try {
    ctx?.ui?.notify?.(message, "info");
  } catch {}
};

export default function abide(pi) {
  /**
   * Per session: the turn being checked, whether the agent loop is running, and
   * whether abide's own turn repair is the next prompt. oh-my-pi fires
   * before_agent_start for that repair too; it continues the turn it was raised in.
   */
  const sessions = new Map();
  let turns = 0;

  pi.on("before_agent_start", async (event, ctx) => {
    try {
      const sessionId = sessionIdOf(ctx);
      if (sessionId === undefined) return undefined;
      let s = sessions.get(sessionId);
      let message;
      if (s === undefined) {
        s = { turnId: undefined, running: false, repairPending: false };
        sessions.set(sessionId, s);
        const out = await runHook(
          "session-start",
          {
            session_id: sessionId,
            cwd: ctx.cwd,
            hook_event_name: "SessionStart",
            source: "startup",
          },
          10_000,
        );
        const context = out?.hookSpecificOutput?.additionalContext;
        if (typeof context === "string" && context !== "")
          message = { customType: "abide", content: context, display: false };
        notify(ctx, out?.systemMessage);
      }
      if (s.repairPending) {
        s.repairPending = false;
      } else if (!s.running) {
        // A prompt steered into a running loop belongs to the turn already open.
        turns += 1;
        s.turnId = `omp-${Date.now().toString(36)}-${turns}`;
        await runHook(
          "turn-start",
          {
            session_id: sessionId,
            prompt_id: s.turnId,
            cwd: ctx.cwd,
            hook_event_name: "UserPromptSubmit",
            prompt: typeof event?.prompt === "string" ? event.prompt : "",
          },
          10_000,
        );
      }
      return message === undefined ? undefined : { message };
    } catch {
      return undefined;
    }
  });

  pi.on("agent_start", async (_event, ctx) => {
    try {
      const s = sessions.get(sessionIdOf(ctx));
      if (s !== undefined) s.running = true;
    } catch {}
  });

  pi.on("agent_end", async (_event, ctx) => {
    try {
      const s = sessions.get(sessionIdOf(ctx));
      if (s !== undefined) s.running = false;
    } catch {}
  });

  pi.on("tool_result", async (event, ctx) => {
    try {
      if (event?.isError || event.toolName !== "edit") return undefined;
      const sessionId = sessionIdOf(ctx);
      const s = sessions.get(sessionId);
      if (s?.turnId === undefined) return undefined;

      const files = editedFiles(event.details);
      if (files.length === 0) return undefined;

      const outs = await Promise.all(
        files.map((f) =>
          runHook(
            "post-tool-use",
            {
              ...writePayload(f),
              session_id: sessionId,
              prompt_id: s.turnId,
              cwd: ctx.cwd,
              hook_event_name: "PostToolUse",
              tool_use_id: event.toolCallId,
            },
            20_000,
          ),
        ),
      );
      for (const out of outs) notify(ctx, out?.systemMessage);
      const reasons = outs.flatMap((out) =>
        out?.decision === "block" && typeof out.reason === "string" ? [out.reason] : [],
      );
      if (reasons.length === 0) return undefined;
      const content = Array.isArray(event.content) ? event.content : [];
      return { content: [...content, { type: "text", text: reasons.join("\n\n") }] };
    } catch {
      return undefined;
    }
  });

  pi.on("session_stop", async (event, ctx) => {
    try {
      const sessionId = typeof event?.session_id === "string" ? event.session_id : sessionIdOf(ctx);
      const s = sessions.get(sessionId);
      if (s?.turnId === undefined) return undefined;
      const out = await runHook(
        "stop",
        {
          session_id: sessionId,
          prompt_id: s.turnId,
          cwd: ctx.cwd,
          hook_event_name: "Stop",
          stop_hook_active: event.stop_hook_active === true,
        },
        30_000,
      );
      notify(ctx, out?.systemMessage);
      if (out?.decision !== "block" || typeof out.reason !== "string") return undefined;
      s.repairPending = true;
      return { decision: "block", reason: out.reason };
    } catch {
      return undefined;
    }
  });
}
