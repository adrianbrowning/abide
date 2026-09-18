import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { AbideError } from "@coldtea/abide-schema";
import { hasApiKey, NO_KEY_HINT } from "../lib/credentials.js";
import { loadRules } from "../lib/loadRules.js";
import { findRepoRoot } from "../lib/paths.js";
import {
  driftByTurn,
  parseTranscript,
  replaySessions,
  tallyRules,
  type ReplaySession,
} from "../lib/replay.js";
import { say, usd } from "../lib/ui.js";
import { Header } from "../ui/components/Header.js";
import { showLive } from "../ui/render.js";
import { ReplayView, type ReplayData } from "../ui/views/ReplayView.js";

const transcriptFiles = (target: string): string[] => {
  const stat = statSync(target);
  if (stat.isFile()) return [target];
  return readdirSync(target)
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => path.join(target, name))
    .sort();
};

/** Judges every edit of past sessions as if abide had been installed, and reports drift by turn and hits by rule. */
export const runReplay = async (argv: string[]): Promise<number> => {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      repo: { type: "string" },
      concurrency: { type: "string", default: "3" },
      "max-sessions": { type: "string" },
      diffs: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
    },
  });
  if (positionals.length === 0)
    throw new AbideError(
      "RUBRIC_MISSING",
      "name a transcript file or a directory of them, for example ~/.claude/projects/<repo>",
    );
  const files = positionals.flatMap(transcriptFiles);
  const cap = values["max-sessions"] === undefined ? Infinity : Number(values["max-sessions"]);
  const sessions: ReplaySession[] = files
    .map(parseTranscript)
    .filter((s) => s.turns.length > 0)
    .slice(0, cap);
  const root = findRepoRoot(values.repo ?? sessions[0]?.cwd ?? process.cwd());
  if (!hasApiKey(root)) throw new AbideError("NO_API_KEY", NO_KEY_HINT);
  const loaded = loadRules(root);
  if (loaded.rules.length === 0)
    throw new AbideError(
      "RUBRIC_MISSING",
      `no rubric in ${root} or ~/.abide; run abide compile there first`,
    );
  const editCount = sessions.reduce(
    (n, s) => n + s.turns.reduce((m, t) => m + t.edits.length, 0),
    0,
  );
  const concurrency = Math.max(1, Number(values.concurrency));

  const run = async (progress: (label: string) => void): Promise<ReplayData> => {
    const started = performance.now();
    const result = await replaySessions(
      sessions,
      loaded.rules,
      loaded.thresholds,
      concurrency,
      (done, total, spend) => progress(`${done} of ${total} edits · about ${usd(spend)}`),
      values.diffs,
    );
    return {
      root,
      sessions: sessions.length,
      edits: editCount,
      result,
      drift: driftByTurn(result.edits),
      tallies: tallyRules(result, loaded.rules),
      spendUsd:
        result.edits.reduce((s, e) => s + e.costUsd, 0) +
        result.turns.reduce((s, t) => s + t.costUsd, 0),
      elapsedMs: performance.now() - started,
    };
  };

  if (values.json) {
    const data = await run(() => {});
    say(
      JSON.stringify({
        root,
        sessions: data.sessions,
        edits: data.edits,
        spendUsd: data.spendUsd,
        elapsedMs: data.elapsedMs,
        drift: data.drift,
        byRule: data.tallies,
        editResults: data.result.edits,
        turnResults: data.result.turns,
      }),
    );
    return 0;
  }
  return showLive<ReplayData>({
    header: Header({
      command: "replay",
      where: root,
      note: `${sessions.length} sessions, ${editCount} edits, ${concurrency} at a time`,
    }),
    run,
    done: (data) => ReplayView({ data }),
  });
};
