/** Writers for `dynt mcp --agent …`: point coding agents at Dynt's MCP server. */
export const MCP_URL = "https://api.dynt.ai/mcp";

export type JsonMcp = { mcpServers: Record<string, unknown>; [k: string]: unknown };

export function mergeJsonMcpConfig(existing: string, type: "http" | "streamable-http", apiKey?: string): JsonMcp {
  let cfg: JsonMcp = { mcpServers: {} };
  if (existing.trim()) {
    const parsed = JSON.parse(existing) as Partial<JsonMcp>;
    cfg = { ...parsed, mcpServers: { ...(parsed.mcpServers ?? {}) } };
  }
  cfg.mcpServers.dynt = { type, url: MCP_URL, ...(apiKey ? { headers: { Authorization: `Bearer ${apiKey}` } } : {}) };
  return cfg;
}

export function mergeCodexToml(existing: string, apiKey?: string): string {
  if (/^\[mcp_servers\.dynt\]/m.test(existing)) return existing;
  const block = [`[mcp_servers.dynt]`, `url = "${MCP_URL}"`, ...(apiKey ? [`bearer_token_env_var = "DYNT_API_KEY"`] : [])].join("\n");
  return (existing.trimEnd() + "\n\n" + block + "\n").replace(/^\n+/, "");
}

export type AgentName = "claude-code" | "cursor" | "codex" | "vscode" | "windsurf";
export const AGENTS: AgentName[] = ["claude-code", "cursor", "codex", "vscode", "windsurf"];
