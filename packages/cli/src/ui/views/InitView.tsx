import { Box, Text } from "ink";
import { assertNever } from "@coldtea/abide-schema";
import { Callout } from "../components/Callout.js";
import { Checklist, type Step } from "../components/Checklist.js";
import { Header } from "../components/Header.js";
import { palette, scopeLabel } from "../theme.js";

export type InitData =
  | { kind: "no-key"; root: string; envName: string }
  | { kind: "no-sources"; root: string }
  | {
      kind: "installed";
      root: string;
      steps: Step[];
      sources: { path: string; scope: string; global: boolean }[];
      rubric: { path: string; rules: number } | null;
    };

export function InitView({ data }: { data: InitData }) {
  switch (data.kind) {
    case "no-key":
      return (
        <Box flexDirection="column">
          <Header command="init" where={data.root} />
          <Callout
            tone="warn"
            title={`${data.envName} is not set, so abide has nothing to check with`}
          >
            <Text color={palette.cloud}>Two ways to get one:</Text>
            <Text color={palette.cloud}>
              {" "}
              1. Vercel CLI: <Text color={palette.ceramic}>vercel ai-gateway api-keys create</Text>
            </Text>
            <Text color={palette.cloud}>
              {" "}
              2. Vercel dashboard: AI Gateway, then API keys, then create.
            </Text>
            <Text color={palette.mist}>
              Then put it in your shell profile: export {data.envName}=...
            </Text>
            <Text color={palette.ash}>
              The key is read from the environment only. Never a flag; abide never writes it to
              disk.
            </Text>
          </Callout>
        </Box>
      );
    case "no-sources":
      return (
        <Box flexDirection="column">
          <Header command="init" where={data.root} />
          <Callout tone="warn" title="Found 0 instruction files, so there are 0 rules">
            <Text color={palette.cloud}>
              Add an AGENTS.md and run abide init again. Abide ships no rules of its own.
            </Text>
          </Callout>
        </Box>
      );
    case "installed":
      return (
        <Box flexDirection="column">
          <Header command="init" where={data.root} />
          <Checklist steps={data.steps} />
          <Box flexDirection="column" marginTop={1}>
            <Text color={palette.mist}>Instruction files</Text>
            {data.sources.map((s) => (
              <Box key={s.path}>
                <Text color={palette.cloud}> {s.path}</Text>
                <Text color={palette.ash}>
                  {" "}
                  {s.global
                    ? "global, every repo"
                    : s.scope === "**/*"
                      ? "everywhere in this repo"
                      : `applies to ${scopeLabel([s.scope])}`}
                </Text>
              </Box>
            ))}
          </Box>
          <Box marginTop={1}>
            {data.rubric ? (
              <Callout tone="ok" title={`Rubric present: ${data.rubric.rules} rules`}>
                <Text color={palette.mist}>
                  {data.rubric.path}. It is rehashed at the start of every session.
                </Text>
              </Callout>
            ) : (
              <Callout tone="accent" title="Next: start a Claude Code session in this repo">
                <Text color={palette.cloud}>
                  Its first turn compiles the rubric, on your own subscription.
                </Text>
                <Text color={palette.mist}>
                  To compile right now instead: <Text color={palette.ceramic}>abide compile</Text>
                </Text>
              </Callout>
            )}
          </Box>
          <Text color={palette.ash}>
            Later: abide report shows what fired, abide bench measures latency and spend here.
          </Text>
        </Box>
      );
    default:
      return assertNever(data);
  }
}
