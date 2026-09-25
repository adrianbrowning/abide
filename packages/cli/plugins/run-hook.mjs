// Runs the abide hook script for a host plugin that has no hook processes of
// its own. Resolves the script's JSON answer, or undefined on any failure: a
// plugin must never throw into its host.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const HOOK = fileURLToPath(new URL("../dist/abide-hook.js", import.meta.url));

export const runHook = (name, payload, timeoutMs) =>
  new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    let child;
    try {
      child = spawn("node", [HOOK, name], { stdio: ["pipe", "pipe", "ignore"] });
    } catch {
      finish(undefined);
      return;
    }
    const chunks = [];
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {}
      finish(undefined);
    }, timeoutMs);
    // EPIPE from a child that exited early arrives async; unheard it kills the host.
    child.stdin.on("error", () => {});
    child.stdout.on("error", () => {});
    child.stdout.on("data", (c) => chunks.push(c));
    child.on("error", () => {
      clearTimeout(timer);
      finish(undefined);
    });
    child.on("close", () => {
      clearTimeout(timer);
      const text = Buffer.concat(chunks).toString("utf8").trim();
      if (text === "") {
        finish(undefined);
        return;
      }
      try {
        finish(JSON.parse(text));
      } catch {
        finish(undefined);
      }
    });
    try {
      child.stdin.end(JSON.stringify(payload));
    } catch {
      clearTimeout(timer);
      finish(undefined);
    }
  });
