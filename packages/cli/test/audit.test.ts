import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Rule } from "@coldtea/abide-schema";
import {
  auditableFiles,
  fileAsAdded,
  fileAsChunks,
  listRepoFiles,
  tallyByRule,
} from "../src/lib/audit.js";

const rule = (id: string, scope?: string[]): Rule => ({
  id,
  text: "t",
  source: { path: "AGENTS.md" },
  status: "active",
  when: "edit",
  ...(scope ? { scope } : {}),
  check: { type: "model", question: { type: "boolean", instructions: "?" } },
});

describe("audit", () => {
  it("lists tracked and untracked files, skips ignored and generated ones, and keeps only files a rule applies to", () => {
    const root = mkdtempSync(path.join(tmpdir(), "abide-audit-"));
    mkdirSync(path.join(root, "src"));
    mkdirSync(path.join(root, "styles"));
    writeFileSync(path.join(root, "src", "a.ts"), "export const a = 1;\n");
    writeFileSync(path.join(root, "styles", "x.css"), ".a{}\n");
    writeFileSync(path.join(root, "pnpm-lock.yaml"), "lock\n");
    writeFileSync(path.join(root, ".gitignore"), "ignored.ts\n");
    writeFileSync(path.join(root, "ignored.ts"), "nope\n");
    execSync(
      "git init -q . && git add src .gitignore && git -c user.email=a@b -c user.name=a commit -q -m init",
      { cwd: root },
    );
    writeFileSync(path.join(root, "src", "untracked.ts"), "export const u = 1;\n");
    const files = listRepoFiles(root, []);
    expect(files.sort()).toEqual([".gitignore", "src/a.ts", "src/untracked.ts", "styles/x.css"]);
    const { files: kept, skipped } = auditableFiles(root, files, [rule("ts-only", ["**/*.ts"])]);
    expect(kept.sort()).toEqual(["src/a.ts", "src/untracked.ts"]);
    expect(skipped.outOfScope).toBe(2);
  });

  it("presents a file as one hunk of added lines, or as chunks that keep their line numbers", () => {
    expect(fileAsAdded("a\nb\n")).toBe("@@ -0,0 +1,2 @@\n+a\n+b");
    const lines = Array.from({ length: 7 }, (_, i) => `l${i + 1}`).join("\n");
    expect(fileAsChunks(lines, 3)).toEqual([
      "@@ -0,0 +1,3 @@\n+l1\n+l2\n+l3",
      "@@ -0,0 +4,3 @@\n+l4\n+l5\n+l6",
      "@@ -0,0 +7,1 @@\n+l7",
    ]);
    expect(fileAsChunks("")).toEqual([]);
  });

  it("tallies by rule, loudest first", () => {
    const tallies = tallyByRule([
      {
        file: "a.ts",
        rules: 2,
        latencyMs: 1,
        costUsd: 0,
        verdicts: [
          { ruleId: "x", probability: 0.9, band: "act" },
          { ruleId: "y", probability: 0.6, band: "flag" },
        ],
      },
      {
        file: "b.ts",
        rules: 2,
        latencyMs: 1,
        costUsd: 0,
        verdicts: [
          { ruleId: "x", probability: 0.95, band: "act" },
          { ruleId: "y", probability: 0.1, band: "clear" },
        ],
      },
    ]);
    expect(tallies.map((t) => [t.ruleId, t.broken, t.flagged, t.checked])).toEqual([
      ["x", ["a.ts", "b.ts"], [], 2],
      ["y", [], ["a.ts"], 2],
    ]);
  });
});
