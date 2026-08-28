import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isExpired, pkcePair } from "../src/pkce.js";

describe("pkce", () => {
  it("produces an S256 challenge of a 43–128 char verifier", () => {
    const { verifier, challenge } = pkcePair();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
  });
  it("treats tokens as expired one minute early", () => {
    expect(isExpired(Date.now() + 30_000)).toBe(true);
    expect(isExpired(Date.now() + 120_000)).toBe(false);
  });
});
