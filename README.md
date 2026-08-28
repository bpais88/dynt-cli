# dynt — Dynt from the terminal

For people and agents. Every Dynt MCP tool is a command, generated from the live tool catalogue (`https://api.dynt.ai/v1/public/agent-tools/spec`), so the CLI and the MCP server can never disagree.

```
dynt <command> [options]           auth · env · tools · skills · whoami
dynt <resource> <tool> [options]   e.g. dynt transactions list --startDate 2026-08-01
```

## Install

```bash
npm i -g github:bpais88/dynt-cli     # (npm package coming)
dynt auth login                      # opens the browser: sign in, pick organization + permissions
dynt whoami
```

Headless / CI: `DYNT_API_KEY=dynt_… dynt transactions summary --agent` (keys from Organization → API keys).

## Set up your coding agent

```bash
dynt mcp --agent claude-code --agent cursor      # writes MCP config; OAuth sign-in on first use
dynt mcp --agent codex --api-key dynt_…          # or a key for headless agents
dynt plugins --agent claude-code -y              # skills + MCP in one package (Claude Code, Codex)
dynt skills install                              # just the skills, into ./.claude/skills or your agent's dir
```

## For agents

- `--agent` (or any pipe) prints a stable envelope: `{"schema_version":"1.0","data":…,"pagination":{"nextCursor","hasMore"}|null}`; errors are `{"error":{"code","message"}}` with exit codes `2` auth, `3` tool error, `4` cancelled.
- `--no-input` disables prompts; destructive tools ask for confirmation only on a TTY.
- `--dry-run` prints the exact tool call without sending it.
- `dynt tools list` shows every command with access and read-only/destructive flags; `dynt <resource> <tool> --help` shows inputs with types, choices and defaults.
- `dynt skills install` installs the Dynt agent skills for your coding agent.

## Options

```
-e, --env <env>        sandbox | production
-o, --output <format>  json | table
--agent / --human      force JSON / table
-q, --quiet            no progress output
--no-input             no interactive prompts
--wide                 all columns in tables
--api-key <key>        use a dynt_ API key
```

Config lives in `~/.config/dynt/` (`credentials.json` is 0600). Set `DYNT_NO_BROWSER=1` to print the sign-in URL instead of opening a browser.

## Develop

```bash
npm install && npm test && npm run build
node dist/index.js tools list
```
