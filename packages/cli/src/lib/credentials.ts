import { chmodSync, lstatSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { AbideError } from "@coldtea/abide-schema";
import { globalAbideDir } from "./paths.js";
import {
  ENDPOINT_URL_ENV,
  GATEWAY_KEY_ENV,
  TYPESAFE_BASE_URL_ENV,
  TYPESAFE_KEY_ENV,
} from "./constants.js";
import { readRegularText, writeRegularFile } from "./regularFile.js";

/**
 * Which key abide has, and where it goes. A TypeSafe key talks to Jev
 * directly; a gateway key goes through the user's Vercel AI Gateway. The
 * direct call may carry a base URL to reach an API-compatible endpoint of
 * one's own instead of typesafe.ai. A keyless endpoint is named on its own
 * variable and beats every key, so a saved TypeSafe key is never sent to it.
 */
export type Credentials =
  | { kind: "typesafe"; key: string; baseURL?: string; from: string }
  | { kind: "gateway"; key: string; from: string }
  | { kind: "endpoint"; baseURL: string; from: string }
  | { kind: "none" };

export const KEY_NAMES: readonly string[] = [TYPESAFE_KEY_ENV, GATEWAY_KEY_ENV];

/** URLs are not secrets and are never written by abide, only read alongside the keys. */
const READ_NAMES: readonly string[] = [...KEY_NAMES, TYPESAFE_BASE_URL_ENV, ENDPOINT_URL_ENV];

export const userEnvPath = (): string => path.join(globalAbideDir(), ".env");

export const projectEnvPath = (root: string): string => path.join(root, ".env.local");

/** Only abide's keys and URLs are read from a file; nothing else in it is touched or loaded. */
export const parseEnvFile = (text: string): Map<string, string> => {
  const found = new Map<string, string>();
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (m === null) continue;
    const name = m[1];
    let value = (m[2] ?? "").trim();
    if (name === undefined || !READ_NAMES.includes(name)) continue;
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value !== "") found.set(name, value);
  }
  return found;
};

const readEnvFile = (file: string): Map<string, string> => {
  const text = readRegularText(file);
  return text === undefined ? new Map() : parseEnvFile(text);
};

/** A cloned repo must not pick where diffs go without a key, so its files never name the keyless endpoint. */
const readRepoEnvFile = (file: string): Map<string, string> => {
  const vars = readEnvFile(file);
  vars.delete(ENDPOINT_URL_ENV);
  return vars;
};

const pick = (vars: Map<string, string>, from: string): Credentials => {
  const typesafe = vars.get(TYPESAFE_KEY_ENV);
  if (typesafe !== undefined) return { kind: "typesafe", key: typesafe, from };
  const gateway = vars.get(GATEWAY_KEY_ENV);
  if (gateway !== undefined) return { kind: "gateway", key: gateway, from };
  return { kind: "none" };
};

const fromProcessEnv = (): Map<string, string> => {
  const vars = new Map<string, string>();
  for (const name of READ_NAMES) {
    const value = (process.env[name] ?? "").trim();
    if (value !== "") vars.set(name, value);
  }
  return vars;
};

/** The base URL travels with a direct key; a gateway key ignores it. */
const withBaseURL = (creds: Credentials, baseURL: string | undefined): Credentials =>
  creds.kind === "typesafe" && baseURL !== undefined ? { ...creds, baseURL } : creds;

const firstOf = (
  scanned: readonly [string, Map<string, string>][],
  name: string,
): { value: string; from: string } | undefined => {
  for (const [from, vars] of scanned) {
    const value = vars.get(name);
    if (value !== undefined) return { value, from };
  }
  return undefined;
};

/** A keyless endpoint wins outright; otherwise the first source with a key, carrying any base URL. */
const choose = (scanned: readonly [string, Map<string, string>][]): Credentials => {
  const endpoint = firstOf(scanned, ENDPOINT_URL_ENV);
  if (endpoint !== undefined)
    return { kind: "endpoint", baseURL: endpoint.value, from: endpoint.from };
  const baseURL = firstOf(scanned, TYPESAFE_BASE_URL_ENV)?.value;
  for (const [from, vars] of scanned) {
    const picked = pick(vars, from);
    if (picked.kind !== "none") return withBaseURL(picked, baseURL);
  }
  return { kind: "none" };
};

export const findCredentials = (root: string): Credentials => {
  const places: [string, () => Map<string, string>][] = [
    ["the environment", fromProcessEnv],
    [".env.local", () => readRepoEnvFile(path.join(root, ".env.local"))],
    [".env", () => readRepoEnvFile(path.join(root, ".env"))],
    [userEnvPath(), () => readEnvFile(userEnvPath())],
  ];
  return choose(places.map(([from, read]): [string, Map<string, string>] => [from, read()]));
};

let current: Credentials | undefined;

export const resolveCredentials = (root: string): Credentials => {
  current ??= findCredentials(root);
  return current;
};

export const credentials = (): Credentials => {
  current ??= choose([["the environment", fromProcessEnv()]]);
  return current;
};

export const hasCredentials = (root: string): boolean => resolveCredentials(root).kind !== "none";

/** Touches only the `NAME=` line. */
export const upsertEnvLine = (text: string, name: string, value: string): string => {
  const line = `${name}=${value}`;
  const lines = text === "" ? [] : text.replace(/\n$/, "").split("\n");
  const at = lines.findIndex((raw) => new RegExp(`^(?:export\\s+)?${name}\\s*=`).test(raw.trim()));
  if (at === -1) lines.push(line);
  else lines[at] = line;
  return `${lines.join("\n")}\n`;
};

const unwritable = (file: string, why: string): AbideError =>
  new AbideError("KEY_FILE_UNWRITABLE", `${file} ${why}, so the key was not written`);

const inspect = (file: string): "missing" | "file" | "other" => {
  try {
    return lstatSync(file).isFile() ? "file" : "other";
  } catch {
    return "missing";
  }
};

/**
 * The only two files abide may write a key to; see AGENTS.md. A symlink could
 * point at a tracked file, and a file we could not read would be erased, so both are refused.
 */
export const saveKey = (file: string, name: string, key: string): string => {
  mkdirSync(path.dirname(file), { recursive: true });
  switch (inspect(file)) {
    case "missing":
      writeFileSync(file, upsertEnvLine("", name, key), { mode: 0o600, flag: "wx" });
      return file;

    case "other":
      throw unwritable(file, "is not a plain file");

    case "file": {
      const existing = readRegularText(file, { followSymlinks: false });
      if (existing === undefined) throw unwritable(file, "could not be read");

      const text = upsertEnvLine(existing, name, key);

      if (!writeRegularFile(file, text, { use: "replace", followSymlinks: false }))
        throw unwritable(file, "could not be written");
      chmodSync(file, 0o600);

      return file;
    }
  }
};

export const NO_KEY_HINT = `No API key found. Run "abide login" with your TypeSafe key, or put ${TYPESAFE_KEY_ENV} in the environment or a .env file at the repo root. For an endpoint that needs no key, such as a local laya-serve, set ${ENDPOINT_URL_ENV} in the environment or ~/.abide/.env.`;
