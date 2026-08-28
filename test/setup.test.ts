import { describe, expect, it } from "vitest";
import { mergeJsonMcpConfig, mergeCodexToml, MCP_URL } from "../src/setup.js";

describe("agent setup config writers", () => {
  it("adds the dynt server to an existing mcpServers object without touching others", () => {
    const out = mergeJsonMcpConfig('{"mcpServers":{"other":{"url":"x"}},"foo":1}', "http");
    expect(out.mcpServers.other).toEqual({ url: "x" });
    expect(out.mcpServers.dynt).toEqual({ type: "http", url: MCP_URL });
    expect(out.foo).toBe(1);
  });
  it("creates the structure from scratch and supports an API-key header", () => {
    const out = mergeJsonMcpConfig("", "streamable-http", "dynt_abc");
    expect(out.mcpServers.dynt).toEqual({ type: "streamable-http", url: MCP_URL, headers: { Authorization: "Bearer dynt_abc" } });
  });
  it("appends a Codex mcp_servers block once", () => {
    const once = mergeCodexToml("[foo]\nbar = 1\n");
    expect(once).toContain("[mcp_servers.dynt]");
    expect(once).toContain(`url = "${MCP_URL}"`);
    expect(mergeCodexToml(once)).toBe(once);
  });
});
