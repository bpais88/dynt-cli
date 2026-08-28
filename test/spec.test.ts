import { describe, expect, it } from "vitest";
import { cliTools, coerceArguments, optionsFor, type Spec, type SpecTool } from "../src/spec.js";

const tool = (over: Partial<SpecTool>): SpecTool => ({
  name: "list_transactions", resource: "transactions", alias: "list", title: "t", description: "d", access: "read",
  platforms: ["mcp", "cli", "web"], annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  inputSchema: { type: "object", properties: {
    startDate: { type: "string", description: "ISO date" },
    limit: { type: "integer", default: 50, minimum: 1, maximum: 500 },
    status: { type: "string", enum: ["needs_review", "synced"] },
    includeBody: { type: "boolean", default: false },
    tags: { type: "array", items: { type: "string" } },
  }, required: ["startDate"] }, ...over });

describe("spec → commands", () => {
  it("groups CLI-platform tools by resource, sorted, and skips web-only tools", () => {
    const spec = { name: "x", version: "1", hash: "h", instructions: "", tools: [
      tool({ name: "b", resource: "proofs", alias: "list" }), tool({ name: "a", resource: "accounts", alias: "list" }),
      tool({ name: "c", resource: "proofs", alias: "attach" }), tool({ name: "w", resource: "web", alias: "x", platforms: ["web"] }),
    ] } as Spec;
    const m = cliTools(spec);
    expect([...m.keys()]).toEqual(["accounts", "proofs"]);
    expect(m.get("proofs")!.map((t) => t.alias)).toEqual(["attach", "list"]);
  });

  it("derives options with the exact field names, kinds, choices and requiredness", () => {
    const o = Object.fromEntries(optionsFor(tool({})).map((x) => [x.name, x]));
    expect(o.startDate.flag).toBe("--startDate <value>");
    expect(o.startDate.required).toBe(true);
    expect(o.limit.kind).toBe("number");
    expect(o.limit.description).toContain("default: 50");
    expect(o.status.choices).toEqual(["needs_review", "synced"]);
    expect(o.includeBody.flag).toBe("--includeBody");
    expect(o.tags.kind).toBe("array");
  });

  it("coerces values and validates enums; --json body merges underneath flags", () => {
    const t = tool({});
    expect(coerceArguments(t, { limit: "10", includeBody: true, tags: "a, b", startDate: "2026-08-01" }, '{"endDate":"2026-08-31","limit":1}'))
      .toEqual({ endDate: "2026-08-31", limit: 10, includeBody: true, tags: ["a", "b"], startDate: "2026-08-01" });
    expect(() => coerceArguments(t, { limit: "ten" })).toThrow("--limit must be a number");
    expect(() => coerceArguments(t, { status: "bogus" })).toThrow("must be one of");
  });
});
