export type AbideErrorCode =
  | "NO_API_KEY"
  | "NO_INSTRUCTION_FILES"
  | "RUBRIC_INVALID"
  | "RUBRIC_MISSING"
  | "SETTINGS_INVALID"
  | "GIT_UNAVAILABLE"
  | "CLAUDE_UNAVAILABLE"
  | "CHECK_TIMEOUT"
  | "CHECK_FAILED";

export class AbideError extends Error {
  readonly code: AbideErrorCode;

  constructor(code: AbideErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AbideError";
    this.code = code;
  }
}

export const isAbideError = (value: unknown): value is AbideError => value instanceof AbideError;
