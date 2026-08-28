#!/usr/bin/env node
/**
 * dynt — Dynt from the terminal, for people and agents.
 *
 *   dynt <command> [options]            auth · env · tools · skills · whoami
 *   dynt <resource> <tool> [options]    generated from the live tool catalogue
 *
 * Output: JSON envelope when piped or with --agent; tables on a TTY or with --human.
 */
import { Command, Option } from "commander";
import { spawnSync } from "node:child_process";
import { readCachedSpec, readConfig, writeCachedSpec, writeConfig } from "./config.js";
import { AuthRequired, bearer, login, logout, status } from "./auth.js";
import { McpAuthError, McpClient, ToolError } from "./mcp.js";
import { errorEnvelope, renderTable, resolveFormat, toEnvelope } from "./output.js";
import { cliTools, coerceArguments, DEFAULT_ENVIRONMENTS, optionsFor, type EnvName, type Spec, type SpecTool } from "./spec.js";
import { AGENTS, mergeCodexToml, mergeJsonMcpConfig, type AgentName } from "./setup.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const VERSION = "0.1.0";
const SPEC_TTL_MS = 60 * 60 * 1000;

interface GlobalOpts { env?: EnvName; output?: string; agent?: boolean; human?: boolean; quiet?: boolean; input?: boolean; wide?: boolean; apiKey?: string }

const program = new Command("dynt")
  .description("Dynt from the terminal, for people and agents")
  .version(VERSION, "--version", "Show the version and exit.")
  .addOption(new Option("-e, --env <env>", "Environment: sandbox or production").choices(["sandbox", "production"]))
  .addOption(new Option("-o, --output <format>", "Output format: json or table").choices(["json", "table"]))
  .option("-q, --quiet", "Suppress progress output")
  .option("--no-input", "Disable interactive prompts")
  .option("--wide", "Show all columns in table output")
  .option("--agent", "Machine-readable JSON output (default when piped)")
  .option("--human", "Human-readable table output (default in terminal)")
  .option("--api-key <key>", "Use a dynt_ API key instead of the signed-in session (or set DYNT_API_KEY)")
  .showHelpAfterError();

const g = (): GlobalOpts => program.opts<GlobalOpts>();
const env = (): EnvName => g().env ?? readConfig().env;
const fmt = () => resolveFormat(g(), process.stdout.isTTY ?? false);
const log = (s: string) => { if (!g().quiet && fmt() === "table") process.stderr.write(s + "\n"); };

function emit(data: unknown) {
  if (fmt() === "json") { process.stdout.write(JSON.stringify(toEnvelope(data), null, 2) + "\n"); return; }
  const envl = toEnvelope(data);
  process.stdout.write(renderTable(envl.data, g().wide) + "\n");
  if (envl.pagination?.hasMore) process.stderr.write(`… more results: pass --cursor ${JSON.stringify(envl.pagination.nextCursor)}\n`);
}
function fail(code: string, message: string, exit = 1): never {
  if (fmt() === "json") process.stdout.write(JSON.stringify(errorEnvelope(code, message)) + "\n");
  else process.stderr.write(`error: ${message}\n`);
  process.exit(exit);
}

async function loadSpec(force = false): Promise<Spec> {
  const cfg = readConfig();
  const cached = readCachedSpec();
  const fresh = cached && !force && cfg.specCheckedAt && Date.now() - cfg.specCheckedAt < SPEC_TTL_MS;
  if (fresh) return cached!;
  const api = DEFAULT_ENVIRONMENTS[env()].api;
  try {
    if (cached && !force) {
      const { hash } = (await (await fetch(`${api}/v1/public/agent-tools/hash`, { signal: AbortSignal.timeout(5000) })).json()) as { hash: string };
      writeConfig({ ...cfg, specCheckedAt: Date.now() });
      if (hash === cached.hash) return cached;
    }
    const spec = (await (await fetch(`${api}/v1/public/agent-tools/spec`, { signal: AbortSignal.timeout(10000) })).json()) as Spec;
    writeCachedSpec(spec); writeConfig({ ...cfg, specCheckedAt: Date.now() });
    return spec;
  } catch (e) {
    if (cached) return cached;
    throw new Error(`could not download the Dynt tool catalogue: ${(e as Error).message}`);
  }
}

async function client(): Promise<McpClient> {
  const token = await bearer(env(), g().apiKey);
  return new McpClient(`${DEFAULT_ENVIRONMENTS[env()].api}/mcp`, token);
}

async function run(fn: () => Promise<unknown>) {
  try { emit(await fn()); }
  catch (e) {
    if (e instanceof AuthRequired || e instanceof McpAuthError) fail("auth_required", e.message, 2);
    if (e instanceof ToolError) fail("tool_error", e.message, 3);
    fail("error", (e as Error).message);
  }
}

const openBrowser = (url: string) => {
  if (process.env.DYNT_NO_BROWSER) return; // e.g. remote shells: the URL is printed instead
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  spawnSync(cmd, [url], { stdio: "ignore", shell: process.platform === "win32" });
};

// ─── auth ─────────────────────────────────────────────────────────────
const auth = program.command("auth").description("Manage authentication");
auth.command("login").description("Sign in to Dynt in your browser (OAuth, no keys)").action(async () => {
  if (g().input === false) fail("no_input", "auth login needs a browser; use DYNT_API_KEY in non-interactive environments");
  try { await login(env(), openBrowser, log); emit({ signedIn: true, env: env() }); } catch (e) { fail("login_failed", (e as Error).message); }
});
auth.command("logout").description("Forget the stored session").action(() => emit({ signedOut: logout(env()), env: env() }));
auth.command("status").description("Show who you are signed in as").action(() => emit({ env: env(), ...status(env()) }));

// ─── env / tools / skills / whoami ────────────────────────────────────
program.command("env [name]").description("Show or set the default environment").action((name?: EnvName) => {
  if (name) { if (!(name in DEFAULT_ENVIRONMENTS)) fail("bad_env", "use sandbox or production"); writeConfig({ ...readConfig(), env: name }); }
  emit({ env: name ?? readConfig().env, ...DEFAULT_ENVIRONMENTS[name ?? readConfig().env] });
});
const tools = program.command("tools").description("Inspect the tool catalogue");
tools.command("list").description("List every tool with its resource, command and access").action(() => run(async () => {
  const spec = await loadSpec();
  return spec.tools.map((t) => ({ command: `dynt ${t.resource} ${t.alias}`, tool: t.name, access: t.access, readOnly: t.annotations.readOnlyHint, destructive: t.annotations.destructiveHint, title: t.title }));
}));
tools.command("refresh").description("Re-download the tool catalogue").action(() => run(async () => { const s = await loadSpec(true); return { hash: s.hash, tools: s.tools.length }; }));
const skills = program.command("skills").description("Browse and install agent skill instructions");
skills.command("install [names...]").description("Install Dynt skills for your coding agent (all by default)").option("--for <agent>", "Target agent (claude-code, cursor, codex, …)").action((names: string[], o: { for?: string }) => {
  const args = ["-y", "skills", "add", "bpais88/dynt-agent-skills", ...names.flatMap((n) => ["--skill", n]), ...(o.for ? ["--agent", o.for] : []), "-y"];
  const r = spawnSync("npx", args, { stdio: "inherit" }); process.exit(r.status ?? 1);
});
skills.command("list").description("List available Dynt skills").action(() => run(async () => {
  const r = await fetch("https://api.github.com/repos/bpais88/dynt-agent-skills/contents/skills", { headers: { "user-agent": "dynt-cli" } });
  return ((await r.json()) as { name: string }[]).map((e) => ({ skill: e.name, install: `dynt skills install ${e.name}` }));
}));
// ─── setup for coding agents (dynt mcp / dynt plugins / dynt skills) ──
function writeMerged(path: string, merge: (existing: string) => string) {
  mkdirSync(join(path, ".."), { recursive: true });
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  writeFileSync(path, merge(existing));
  return path;
}
program.command("mcp").description("Install the Dynt MCP server into your coding agents (OAuth by default)")
  .addOption(new Option("--for <agent...>", "Target agent(s)").choices(AGENTS))
  .option("--api-key <key>", "Use a dynt_ API key instead of OAuth sign-in on first use")
  .option("--project", "Write project-scoped config (current directory) instead of user-scoped")
  .action((o: { for?: AgentName[]; apiKey?: string; project?: boolean }) => run(async () => {
    const agents = o.for?.length ? o.for : (["claude-code"] as AgentName[]);
    const home = homedir(); const cwd = process.cwd();
    const written: { agent: string; path: string; mode: string }[] = [];
    const mode = o.apiKey ? "api-key" : "oauth (sign in on first use)";
    for (const a of agents) {
      if (a === "claude-code") {
        const args = ["mcp", "add", "--transport", "http", ...(o.project ? ["--scope", "project"] : ["--scope", "user"]), ...(o.apiKey ? ["--header", `Authorization: Bearer ${o.apiKey}`] : []), "dynt", "https://api.dynt.ai/mcp"];
        const r = spawnSync("claude", args, { stdio: g().quiet ? "ignore" : "inherit" });
        if (r.error || r.status) throw new Error("`claude` CLI not found or failed; install Claude Code, or run: claude " + args.join(" "));
        written.push({ agent: a, path: "claude mcp add", mode });
      } else if (a === "cursor") {
        written.push({ agent: a, path: writeMerged(o.project ? join(cwd, ".cursor", "mcp.json") : join(home, ".cursor", "mcp.json"), (e) => JSON.stringify(mergeJsonMcpConfig(e, "http", o.apiKey), null, 2) + "\n"), mode });
      } else if (a === "vscode") {
        written.push({ agent: a, path: writeMerged(join(cwd, ".vscode", "mcp.json"), (e) => JSON.stringify(mergeJsonMcpConfig(e, "http", o.apiKey), null, 2) + "\n"), mode });
      } else if (a === "windsurf") {
        written.push({ agent: a, path: writeMerged(join(home, ".codeium", "windsurf", "mcp_config.json"), (e) => JSON.stringify(mergeJsonMcpConfig(e, "streamable-http", o.apiKey), null, 2) + "\n"), mode });
      } else if (a === "codex") {
        written.push({ agent: a, path: writeMerged(join(home, ".codex", "config.toml"), (e) => mergeCodexToml(e, o.apiKey)), mode: o.apiKey ? "api-key via DYNT_API_KEY env" : mode });
      }
    }
    return written;
  }));
program.command("plugins").description("Install the Dynt plugin (skills + MCP) into agents with plugin marketplaces")
  .addOption(new Option("--for <agent...>", "Target agent(s)").choices(["claude-code", "cursor", "codex"]))
  .option("-y, --yes", "No prompts")
  .action((o: { for?: string[]; yes?: boolean }) => run(async () => {
    const agents = o.for?.length ? o.for : ["claude-code"];
    const out: { agent: string; command: string; status: string }[] = [];
    for (const a of agents) {
      if (a === "claude-code") {
        const add = spawnSync("claude", ["plugin", "marketplace", "add", "bpais88/dynt-agent-skills"], { stdio: g().quiet ? "ignore" : "inherit" });
        const inst = spawnSync("claude", ["plugin", "install", "dynt@dynt"], { stdio: g().quiet ? "ignore" : "inherit" });
        out.push({ agent: a, command: "claude plugin install dynt@dynt", status: add.error || inst.error || inst.status ? "failed — is Claude Code installed?" : "installed" });
      } else if (a === "codex") {
        const r = spawnSync("codex", ["plugin", "add", "bpais88/dynt-agent-skills"], { stdio: g().quiet ? "ignore" : "inherit" });
        out.push({ agent: a, command: "codex plugin add bpais88/dynt-agent-skills", status: r.error || r.status ? "failed — is Codex CLI installed?" : "installed" });
      } else {
        out.push({ agent: a, command: "/add-plugin dynt (after adding bpais88/dynt-agent-skills as a marketplace in Cursor)", status: "manual" });
      }
    }
    return out;
  }));
program.command("whoami").description("Show the identity behind the current credential").action(() => run(async () => (await client()).call("get_current_user", {})));

// ─── generated resource commands ──────────────────────────────────────
function attach(spec: Spec) {
  for (const [resource, list] of cliTools(spec)) {
    const rc = program.command(resource).description(`${list.map((t) => t.alias).join(", ")}`);
    for (const t of list) addToolCommand(rc, t);
  }
}
function addToolCommand(rc: Command, t: SpecTool) {
  const c = rc.command(t.alias).description(`${t.title}${t.annotations.readOnlyHint ? "" : t.annotations.destructiveHint ? " [destructive]" : " [write]"}\n\n${t.description}`);
  for (const o of optionsFor(t)) {
    const opt = new Option(o.flag, o.description);
    if (o.choices) opt.choices(o.choices);
    if (o.required) opt.makeOptionMandatory();
    c.addOption(opt);
  }
  c.option("--json <body>", "Raw JSON body (flags override its keys)");
  c.option("--dry-run", "Print the tool call instead of sending it");
  c.action((opts: Record<string, unknown>) => run(async () => {
    const { json, dryRun, ...raw } = opts as { json?: string; dryRun?: boolean } & Record<string, unknown>;
    const args = coerceArguments(t, raw, json);
    if (dryRun) return { tool: t.name, arguments: args };
    if (t.annotations.destructiveHint && g().input !== false && fmt() === "table") {
      const { createInterface } = await import("node:readline/promises");
      const rl = createInterface({ input: process.stdin, output: process.stderr });
      const a = await rl.question(`This is destructive (${t.name}). Type "yes" to continue: `); rl.close();
      if (a.trim() !== "yes") fail("cancelled", "cancelled", 4);
    }
    return (await client()).call(t.name, args);
  }));
}

const main = async () => {
  const wantsCatalogue = !["auth", "env", "tools", "skills", "whoami", "--help", "-h", "--version", "-V", undefined].includes(process.argv[2]) || process.argv.length <= 2;
  try { if (wantsCatalogue) attach(await loadSpec()); } catch (e) { log(`warning: ${(e as Error).message}`); }
  await program.parseAsync(process.argv);
};
main();
