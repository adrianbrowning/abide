import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { eventSchema, type AbideEvent } from "@coldtea/abide-schema";
import { abideDir, eventsPath } from "./paths.js";

/** Best effort. The log must never take the hook down with it. */
export const appendEvent = (root: string, event: AbideEvent): void => {
  try {
    mkdirSync(abideDir(root), { recursive: true });
    appendFileSync(eventsPath(root), `${JSON.stringify(event)}\n`);
  } catch {
    // nothing to do: logging is optional
  }
};

export const readEvents = (root: string): AbideEvent[] => {
  let raw: string;
  try {
    raw = readFileSync(eventsPath(root), "utf8");
  } catch {
    return [];
  }
  const events: AbideEvent[] = [];
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const parsed = eventSchema.safeParse(JSON.parse(line));
      if (parsed.success) events.push(parsed.data);
    } catch {
      // skip a torn line
    }
  }
  return events;
};
