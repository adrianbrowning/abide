import { Box, Text } from "ink";
import type { ReactNode } from "react";
import { glyph, palette, toneColor, type Tone } from "../theme.js";

type CalloutProps = { tone: Tone; title: string; children?: ReactNode };

/** Something the reader should act on, boxed so it is not lost in a table. */
export function Callout({ tone, title, children }: CalloutProps) {
  const color = toneColor[tone];
  const mark = tone === "ok" ? glyph.check : tone === "bad" ? glyph.cross : glyph.dot;
  const body =
    typeof children === "string" ? <Text color={palette.cloud}>{children}</Text> : children;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={color}
      paddingX={1}
      marginBottom={1}
      alignSelf="flex-start"
    >
      <Text color={color} bold>
        {mark} {title}
      </Text>
      {body ? <Box flexDirection="column">{body}</Box> : null}
    </Box>
  );
}
