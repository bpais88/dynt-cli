/**
 * OAuth 2.1 authorization-code + PKCE against Dynt's authorization server
 * (Supabase Auth). The CLI is a public client: no secret, loopback redirect.
 * Headless use: DYNT_API_KEY (or --api-key) bypasses OAuth entirely.
 */
import { createServer } from "node:http";
import { DEFAULT_ENVIRONMENTS, type EnvName } from "./spec.js";
import { readCredentials, writeCredentials } from "./config.js";
import { isExpired, pkcePair, b64url } from "./pkce.js";
import { randomBytes } from "node:crypto";

/** Public (PKCE) client ids registered per environment; override with DYNT_OAUTH_CLIENT_ID. */
const CLIENT_IDS: Record<EnvName, string> = {
  production: "799c0f91-5c69-43ef-95eb-cd6511086c08",
  sandbox: "c61e2cb8-1730-472d-ae25-bc7a80365c5b",
};
export const clientId = (env: EnvName) => process.env.DYNT_OAUTH_CLIENT_ID || CLIENT_IDS[env];
const PORT = 19817;
const REDIRECT = `http://127.0.0.1:${PORT}/callback`;
const SCOPE = "email profile"; // never "openid": Dynt's auth server has no ID-token signing key

type Tokens = { access_token: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string; msg?: string };

async function tokenRequest(env: EnvName, params: Record<string, string>): Promise<Tokens> {
  const res = await fetch(`${DEFAULT_ENVIRONMENTS[env].auth}/oauth/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId(env), ...params }).toString(), signal: AbortSignal.timeout(20000),
  });
  const body = (await res.json().catch(() => ({}))) as Tokens;
  if (!res.ok || !body.access_token) throw new Error(body.error_description || body.msg || body.error || `token endpoint HTTP ${res.status}`);
  return body;
}

function subjectOf(token: string): string | undefined {
  try { return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")).sub; } catch { return undefined; }
}

export function buildAuthorizeUrl(env: EnvName, challenge: string, state: string): string {
  const u = new URL(`${DEFAULT_ENVIRONMENTS[env].auth}/oauth/authorize`);
  u.searchParams.set("response_type", "code"); u.searchParams.set("client_id", clientId(env));
  u.searchParams.set("redirect_uri", REDIRECT); u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256"); u.searchParams.set("scope", SCOPE); u.searchParams.set("state", state);
  return u.toString();
}

/** Interactive login: opens the browser, waits for the loopback callback, stores tokens. */
export async function login(env: EnvName, open: (url: string) => void, log: (s: string) => void): Promise<void> {
  const { verifier, challenge } = pkcePair();
  const state = b64url(randomBytes(18));
  const url = buildAuthorizeUrl(env, challenge, state);
  const code = await new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      const u = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
      if (u.pathname !== "/callback") { res.writeHead(404).end(); return; }
      const ok = u.searchParams.get("state") === state && u.searchParams.get("code");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(ok ? "<h2>Signed in to Dynt ✅</h2><p>You can close this tab and return to the terminal.</p>" : "<h2>Sign-in failed</h2><p>Go back to the terminal and run <code>dynt auth login</code> again.</p>");
      server.close();
      ok ? resolve(u.searchParams.get("code")!) : reject(new Error(u.searchParams.get("error_description") || u.searchParams.get("error") || "state mismatch"));
    });
    server.on("error", reject);
    server.listen(PORT, "127.0.0.1", () => { log(`Opening your browser to sign in to Dynt…\nIf it does not open, visit:\n${url}\n`); open(url); });
    setTimeout(() => { server.close(); reject(new Error("timed out waiting for sign-in")); }, 5 * 60 * 1000).unref();
  });
  const t = await tokenRequest(env, { grant_type: "authorization_code", code, redirect_uri: REDIRECT, code_verifier: verifier });
  if (!t.refresh_token) throw new Error("authorization server returned no refresh token");
  const creds = readCredentials();
  creds[env] = { accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: Date.now() + (t.expires_in ?? 3600) * 1000, sub: subjectOf(t.access_token) };
  writeCredentials(creds);
}

/** Bearer for API calls: --api-key / DYNT_API_KEY, else a fresh OAuth access token (refreshing if needed). */
export async function bearer(env: EnvName, apiKey?: string): Promise<string> {
  if (apiKey) return apiKey;
  if (process.env.DYNT_API_KEY) return process.env.DYNT_API_KEY;
  const creds = readCredentials();
  const c = creds[env];
  if (!c) throw new AuthRequired();
  if (!isExpired(c.expiresAt)) return c.accessToken;
  try {
    const t = await tokenRequest(env, { grant_type: "refresh_token", refresh_token: c.refreshToken });
    creds[env] = { accessToken: t.access_token, refreshToken: t.refresh_token ?? c.refreshToken, expiresAt: Date.now() + (t.expires_in ?? 3600) * 1000, sub: subjectOf(t.access_token) ?? c.sub };
    writeCredentials(creds);
    return t.access_token;
  } catch (e) {
    throw new AuthRequired(`session could not be refreshed (${(e as Error).message})`);
  }
}

export function logout(env: EnvName): boolean {
  const creds = readCredentials();
  const had = !!creds[env];
  delete creds[env];
  writeCredentials(creds);
  return had;
}

export function status(env: EnvName): { signedIn: boolean; sub?: string; expiresAt?: number; viaApiKey: boolean } {
  if (process.env.DYNT_API_KEY) return { signedIn: true, viaApiKey: true };
  const c = readCredentials()[env];
  return c ? { signedIn: true, sub: c.sub, expiresAt: c.expiresAt, viaApiKey: false } : { signedIn: false, viaApiKey: false };
}

export class AuthRequired extends Error {
  constructor(detail?: string) { super(`Not signed in${detail ? ` — ${detail}` : ""}. Run \`dynt auth login\` (or set DYNT_API_KEY).`); this.name = "AuthRequired"; }
}
