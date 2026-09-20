import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GATEWAY_KEY_ENV, GATEWAY_MODEL_ID } from "../src/lib/constants.js";
import { evaluationTarget } from "../src/lib/jev.js";

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
});
