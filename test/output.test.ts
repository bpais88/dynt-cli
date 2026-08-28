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

describe("output — unwrapping and flattening", () => {
  it("unwraps a single-array result object into rows and keeps the rest as meta", () => {
    const e = toEnvelope({ accounts: [{ id: "a", balance: 1 }], total: 1 });
    expect(e.data).toEqual([{ id: "a", balance: 1 }]);
    expect(e.meta).toEqual({ total: 1 });
    expect(e.pagination).toBeNull();
  });
  it("flattens nested objects in a single-row table", () => {
    const t = renderTable({ totalTransactions: 300, income: { total: 10.5, count: 2 }, expenses: { total: 20, count: 3 } });
    expect(t).toContain("income.total");
    expect(t).toContain("10.50");
    expect(t).not.toContain("{…}");
  });
});
