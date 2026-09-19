import { Text } from "ink";
import type { Rule } from "@coldtea/abide-schema";
import { bucketCounts } from "../../lib/rubricFile.js";
import { Callout } from "../components/Callout.js";
import { palette } from "../theme.js";

export type CompileDoneData = {
  which: "project" | "global";
  file: string;
  rules: readonly Rule[];
};

const idsWithStatus = (rules: readonly Rule[], status: Rule["status"]): string[] =>
  rules.filter((r) => r.status === status).map((r) => r.id);

/** The box after a compile: what landed, what is off, and what to do with the file now. */
export function CompileDoneView({ data }: { data: CompileDoneData }) {
  const c = bucketCounts(data.rules);
  const weak = idsWithStatus(data.rules, "weak");
  const noisy = idsWithStatus(data.rules, "noisy");
  const disabled = idsWithStatus(data.rules, "disabled");
  const off = weak.length + noisy.length + disabled.length;
  const tune = data.which === "global" ? "abide tune --global" : "abide tune";
  const title =
    off === 0
      ? "Next: read the rubric"
      : `Next: read the rubric. ${off} ${off === 1 ? "rule is" : "rules are"} switched off`;

  return (
    <Callout tone={weak.length + noisy.length === 0 ? "accent" : "warn"} title={title}>
      <Text color={palette.cloud}>
        {c.total} rules at <Text color={palette.ceramic}>{data.file}</Text>: {c.model} judged by the
        model, {c.lint} for your linter, {c.deferred} deferred, {c.unenforceable} unenforceable
      </Text>
      {weak.length > 0 ? (
        <Text color={palette.amber}>
          Weak: {weak.join(", ")}. Weak rules scored in the middle on every historic change
        </Text>
      ) : null}
      {noisy.length > 0 ? (
        <Text color={palette.amber}>
          Noisy: {noisy.join(", ")}. Noisy rules fired on most historic changes
        </Text>
      ) : null}
      {weak.length + noisy.length > 0 ? (
        <Text color={palette.mist}>
          Off until rewritten: <Text color={palette.ceramic}>{tune}</Text>
        </Text>
      ) : null}
      {disabled.length > 0 ? (
        <Text color={palette.mist}>Off by hand: {disabled.join(", ")}</Text>
      ) : null}
      <Text color={palette.cloud}>
        Each rule quotes your own words. Rewrite any question you would put differently
        {data.which === "project" ? ", then commit the file so teammates get the same rules" : ""}
      </Text>
      {off === 0 ? (
        <Text color={palette.mist}>
          Then: <Text color={palette.ceramic}>abide audit src/</Text> checks code you already have.{" "}
          <Text color={palette.ceramic}>abide report</Text> shows what fires from here on
        </Text>
      ) : null}
    </Callout>
  );
}
