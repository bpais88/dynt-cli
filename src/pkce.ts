import { createHash, randomBytes } from "node:crypto";
export const b64url = (b: Buffer) => b.toString("base64url");
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(48));
  return { verifier, challenge: b64url(createHash("sha256").update(verifier).digest()) };
}
export function isExpired(expiresAt: number, skewMs = 60_000): boolean {
  return Date.now() + skewMs >= expiresAt;
}
