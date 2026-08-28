/** Minimal Streamable HTTP MCP client: initialize once per process, then tools/call. */
export class McpClient {
  private sessionId: string | null = null;
  constructor(private url: string, private token: string) {}

  private headers(extra: Record<string, string> = {}) {
    return { authorization: `Bearer ${this.token}`, "content-type": "application/json", accept: "application/json, text/event-stream", "user-agent": "dynt-cli", ...extra };
  }

  private async rpc(body: unknown, session = true): Promise<{ res: Response; text: string }> {
    const res = await fetch(this.url, { method: "POST", headers: this.headers(session && this.sessionId ? { "mcp-session-id": this.sessionId } : {}), body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
    return { res, text: await res.text() };
  }

  async init(): Promise<void> {
    const { res } = await this.rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "dynt-cli", version: "0.1.0" } } }, false);
    if (res.status === 401 || res.status === 403) throw new McpAuthError();
    if (!res.ok) throw new Error(`Dynt MCP initialize failed: HTTP ${res.status}`);
    this.sessionId = res.headers.get("mcp-session-id");
    await this.rpc({ jsonrpc: "2.0", method: "notifications/initialized" }).catch(() => {});
  }

  /** Calls a tool and returns its JSON result (parsed from the text content). */
  async call(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.sessionId) await this.init();
    const { res, text } = await this.rpc({ jsonrpc: "2.0", id: Date.now(), method: "tools/call", params: { name, arguments: args } });
    if (res.status === 401 || res.status === 403) throw new McpAuthError();
    if (!res.ok) throw new Error(`Dynt MCP HTTP ${res.status}`);
    const payload = parseRpc(text);
    if (payload?.error) throw new Error(payload.error.message || "MCP error");
    const result = payload?.result as { isError?: boolean; content?: { type: string; text?: string }[]; structuredContent?: unknown } | undefined;
    const textBlock = result?.content?.find((c) => c.type === "text")?.text ?? "";
    let parsed: unknown = textBlock;
    try { parsed = JSON.parse(textBlock); } catch { /* keep text */ }
    if (result?.isError) throw new ToolError((parsed as { error?: string })?.error || textBlock || "tool error");
    return result?.structuredContent ?? parsed;
  }
}

/** Streamable HTTP may answer with JSON or an SSE stream; take the last data event. */
export function parseRpc(text: string): { result?: unknown; error?: { message?: string } } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith("event:") && !trimmed.startsWith("data:")) { try { return JSON.parse(trimmed); } catch { return null; } }
  let last: string | null = null;
  for (const line of trimmed.split("\n")) if (line.startsWith("data:")) last = line.slice(5).trim();
  try { return last ? JSON.parse(last) : null; } catch { return null; }
}

export class McpAuthError extends Error { constructor() { super("Dynt rejected the credential (invalid, revoked or expired). Run `dynt auth login` again."); this.name = "McpAuthError"; } }
export class ToolError extends Error { constructor(m: string) { super(m); this.name = "ToolError"; } }
