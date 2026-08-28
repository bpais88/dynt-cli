import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { EnvName, Spec } from "./spec.js";

export const CONFIG_DIR = process.env.DYNT_CONFIG_DIR || join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "dynt");
const CONFIG = join(CONFIG_DIR, "config.json");
const CREDS = join(CONFIG_DIR, "credentials.json");
const SPEC = join(CONFIG_DIR, "spec.json");

export interface Config { env: EnvName; specCheckedAt?: number }
export interface Credentials { [env: string]: { accessToken: string; refreshToken: string; expiresAt: number; sub?: string } | undefined }

function readJson<T>(path: string, fallback: T): T {
  try { return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : fallback; } catch { return fallback; }
}
function writeJson(path: string, value: unknown, secret = false) {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { mode: secret ? 0o600 : 0o644 });
  if (secret) chmodSync(path, 0o600);
}

export const readConfig = () => readJson<Config>(CONFIG, { env: "production" });
export const writeConfig = (c: Config) => writeJson(CONFIG, c);
export const readCredentials = () => readJson<Credentials>(CREDS, {});
export const writeCredentials = (c: Credentials) => writeJson(CREDS, c, true);
export const readCachedSpec = () => readJson<Spec | null>(SPEC, null);
export const writeCachedSpec = (s: Spec) => writeJson(SPEC, s);
