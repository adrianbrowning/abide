import { once } from "node:events";
import { createServer, type IncomingHttpHeaders } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_THRESHOLDS, ruleSchema } from "@coldtea/abide-schema";
import {
  ENDPOINT_URL_ENV,
  GATEWAY_KEY_ENV,
  GATEWAY_MODEL_ID,
  TYPESAFE_KEY_ENV,
} from "../src/lib/constants.js";
import { checkWithModel, evaluationTarget, isModelRule } from "../src/lib/jev.js";

let savedKey: string | undefined;

beforeEach(() => {
  savedKey = process.env[GATEWAY_KEY_ENV];
});

afterEach(() => {
  if (savedKey === undefined) delete process.env[GATEWAY_KEY_ENV];
  else process.env[GATEWAY_KEY_ENV] = savedKey;
});

describe("evaluationTarget", () => {
  it("asks the gateway to route only to zero-retention providers", async () => {
    const target = await evaluationTarget({
      kind: "gateway",
      key: "gateway-key",
      from: "the environment",
    });

    expect(target.model).toBe(GATEWAY_MODEL_ID);
    expect(target.providerOptions).toEqual({ gateway: { zeroDataRetention: true } });
    expect(process.env[GATEWAY_KEY_ENV]).toBe("gateway-key");
  });

  it("sends no provider options straight to TypeSafe, whose API defines none", async () => {
    const target = await evaluationTarget({
      kind: "typesafe",
      key: "typesafe-key",
      from: "the environment",
    });

    expect(target.providerOptions).toBeUndefined();
  });

  it("builds a direct model against a self-hosted base URL", async () => {
    const target = await evaluationTarget({
      kind: "typesafe",
      key: "typesafe-key",
      baseURL: "http://127.0.0.1:8772/v1",
      from: "the environment",
    });

    expect(target.model).toBeDefined();
    expect(target.providerOptions).toBeUndefined();
  });
});

describe("checkWithModel against a keyless endpoint", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const name of [TYPESAFE_KEY_ENV, ENDPOINT_URL_ENV]) {
      saved[name] = process.env[name];
      delete process.env[name];
    }
    delete process.env[GATEWAY_KEY_ENV];
  });

  afterEach(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("sends a saved TypeSafe key nowhere near it and bills nothing", async () => {
    let seen: IncomingHttpHeaders | undefined;
    const server = createServer((req, res) => {
      seen = req.headers;
      req.resume();
      req.on("end", () => {
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            model: "laya-rl-agent",
            answers: { "no-console": { type: "noul", noul: 0.91, confidence: 0.91 } },
            usage: { input_tokens: 1200, output_tokens: 0 },
          }),
        );
      });
    });
    const rule = ruleSchema.parse({
      id: "no-console",
      text: "No console.log",
      source: { path: "AGENTS.md" },
      when: "edit",
      check: {
        type: "model",
        question: { type: "boolean", instructions: "Is there a console.log?" },
      },
    });
    if (!isModelRule(rule)) throw new Error("fixture is not a model rule");

    try {
      const listening = once(server, "listening");
      server.listen(0, "127.0.0.1");
      await listening;
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("server has no port");
      process.env[TYPESAFE_KEY_ENV] = "real-typesafe-key";
      process.env[ENDPOINT_URL_ENV] = `http://127.0.0.1:${address.port}/v1`;

      const out = await checkWithModel(
        [rule],
        { diff: "+console.log(1)" },
        DEFAULT_THRESHOLDS,
        5_000,
      );
      expect(seen?.authorization).toBeUndefined();
      expect(out.verdicts).toMatchObject([
        { ruleId: "no-console", probability: 0.91, band: "act" },
      ]);
      expect(out.usage).toMatchObject({ inputTokens: 1200, costUsd: 0 });
    } finally {
      const closed = once(server, "close");
      server.close();
      await closed;
    }
  });
});
