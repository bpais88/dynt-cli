import { describe, expect, it } from "vitest";
import { errorEnvelope, renderTable, resolveFormat, toEnvelope } from "../src/output.js";

describe("output", () => {
  it("wraps list results with pagination and scalars without", () => {
    expect(toEnvelope({ transactions: [{ id: 1 }], hasMore: true, nextCursor: 2 }))
      .toEqual({ schema_version: "1.0", data: [{ id: 1 }], pagination: { nextCursor: 2, hasMore: true } });
    expect(toEnvelope({ userId: "u" })).toEqual({ schema_version: "1.0", data: { userId: "u" }, pagination: null });
    expect(errorEnvelope("auth", "x")).toMatchObject({ error: { code: "auth" }, data: [] });
  });

  it("picks json for agents/pipes and tables for humans/TTY", () => {
    expect(resolveFormat({ agent: true }, true)).toBe("json");
    expect(resolveFormat({ human: true }, false)).toBe("table");
    expect(resolveFormat({}, true)).toBe("table");
    expect(resolveFormat({}, false)).toBe("json");
    expect(resolveFormat({ output: "json" }, true)).toBe("json");
  });

  it("renders aligned tables with money formatting and truncation", () => {
    const t = renderTable([{ merchant: "Amazon Web Services EMEA SARL a very long merchant name", amount: 1234.5 }, { merchant: "Wise", amount: 3 }]);
    expect(t.split("\n")[0]).toMatch(/^merchant\s+amount$/);
    expect(t).toContain("1,234.50");
    expect(t).toContain("…");
    expect(renderTable([])).toBe("(no rows)");
  });
});
