import { createHash } from "node:crypto";

/** Rule ids are kebab-case slugs. The compiling agent writes them; the schema enforces the format. */
export const RULE_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export const createRuleId = (text: string): string => {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/^[^a-z]+/, "")
    .slice(0, 48)
    .replace(/-+$/, "");
  return slug.length > 0 ? slug : "rule";
};

/** Source hash stored in the rubric header: sha256 of the file's bytes, hex. */
export const createSourceSha = (content: string | Uint8Array): string =>
  createHash("sha256").update(content).digest("hex");

/** Key for the per-turn block counter: one rule on one file. */
export const createBlockKey = (ruleId: string, relativePath: string): string =>
  `${ruleId}@${relativePath}`;
