import { z } from "zod";

const common = {
  session_id: z.string(),
  prompt_id: z.string().optional(),
  transcript_path: z.string().optional(),
  cwd: z.string(),
  permission_mode: z.string().optional(),
};

export const sessionStartInputSchema = z.object({
  ...common,
  hook_event_name: z.literal("SessionStart"),
  source: z.string().optional(),
  model: z.string().optional(),
});
export type SessionStartInput = z.infer<typeof sessionStartInputSchema>;

export const patchHunkSchema = z.object({
  oldStart: z.number(),
  oldLines: z.number(),
  newStart: z.number(),
  newLines: z.number(),
  lines: z.array(z.string()),
});
export type PatchHunk = z.infer<typeof patchHunkSchema>;

const fileToolResponseSchema = z
  .object({
    filePath: z.string().optional(),
    originalFile: z.string().nullable().optional(),
    structuredPatch: z.array(patchHunkSchema).optional(),
    type: z.string().optional(),
  })
  .passthrough();

export const editToolInputSchema = z.object({
  file_path: z.string(),
  old_string: z.string(),
  new_string: z.string(),
  replace_all: z.boolean().optional(),
});

export const writeToolInputSchema = z.object({
  file_path: z.string(),
  content: z.string(),
});

export const multiEditToolInputSchema = z.object({
  file_path: z.string(),
  edits: z.array(
    z.object({
      old_string: z.string(),
      new_string: z.string(),
      replace_all: z.boolean().optional(),
    }),
  ),
});

const postToolUseBase = {
  ...common,
  hook_event_name: z.literal("PostToolUse"),
  tool_use_id: z.string().optional(),
  tool_response: fileToolResponseSchema.optional(),
};

export const postToolUseInputSchema = z.discriminatedUnion("tool_name", [
  z.object({ ...postToolUseBase, tool_name: z.literal("Edit"), tool_input: editToolInputSchema }),
  z.object({ ...postToolUseBase, tool_name: z.literal("Write"), tool_input: writeToolInputSchema }),
  z.object({
    ...postToolUseBase,
    tool_name: z.literal("MultiEdit"),
    tool_input: multiEditToolInputSchema,
  }),
]);
export type PostToolUseInput = z.infer<typeof postToolUseInputSchema>;

export const stopInputSchema = z.object({
  ...common,
  hook_event_name: z.literal("Stop"),
  stop_hook_active: z.boolean().optional(),
  last_assistant_message: z.string().optional(),
});
export type StopInput = z.infer<typeof stopInputSchema>;

/** What a hook prints to stdout. Only these shapes ever reach the host. */
export type HookOutput =
  | { kind: "silent" }
  | { kind: "session-context"; additionalContext: string; systemMessage?: string }
  | { kind: "block"; reason: string; systemMessage?: string }
  | { kind: "notice"; systemMessage: string };
