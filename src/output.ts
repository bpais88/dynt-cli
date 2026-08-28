/** Agent-facing JSON envelope and human tables. */
export interface Envelope { schema_version: "1.0"; data: unknown; meta?: Record<string, unknown>; pagination: { nextCursor: unknown; hasMore: boolean } | null }
export interface ErrorEnvelope { schema_version: "1.0"; error: { code: string; message: string }; data: []; pagination: null }

/** Lift a tool result into the envelope; list-shaped results expose pagination. */
export function toEnvelope(result: unknown): Envelope {
  if (result && typeof result === "object" && !Array.isArray(result)) {
    const r = result as Record<string, unknown>;
    const { hasMore, nextCursor, ...rest } = r;
    const paginated = "hasMore" in r || "nextCursor" in r;
    const arrayKeys = Object.keys(rest).filter((k) => Array.isArray(rest[k]));
    // `{ accounts: [...], total: n }` → rows + meta; anything else stays as-is.
    if (arrayKeys.length === 1) {
      const [listKey] = arrayKeys;
      const { [listKey]: rows, ...meta } = rest;
      return { schema_version: "1.0", data: rows, ...(Object.keys(meta).length ? { meta } : {}),
        pagination: paginated ? { nextCursor: nextCursor ?? null, hasMore: Boolean(hasMore) } : null };
    }
    if (paginated) return { schema_version: "1.0", data: rest, pagination: { nextCursor: nextCursor ?? null, hasMore: Boolean(hasMore) } };
  }
  return { schema_version: "1.0", data: result, pagination: null };
}

export function errorEnvelope(code: string, message: string): ErrorEnvelope {
  return { schema_version: "1.0", error: { code, message }, data: [], pagination: null };
}

export function resolveFormat(opts: { agent?: boolean; human?: boolean; output?: string }, isTTY: boolean): "json" | "table" {
  if (opts.agent) return "json";
  if (opts.human) return "table";
  if (opts.output === "json" || opts.output === "table") return opts.output;
  return isTTY ? "table" : "json";
}

const money = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Render rows as a fixed-width table; objects/arrays are summarised unless wide. */
const flatten = (o: Record<string, unknown>, prefix = ""): Record<string, unknown> =>
  Object.entries(o).reduce((acc, [k, v]) => {
    if (v && typeof v === "object" && !Array.isArray(v)) Object.assign(acc, flatten(v as Record<string, unknown>, `${prefix}${k}.`));
    else acc[`${prefix}${k}`] = v;
    return acc;
  }, {} as Record<string, unknown>);

export function renderTable(data: unknown, wide = false): string {
  const rows = Array.isArray(data) ? data : data && typeof data === "object" ? [flatten(data as Record<string, unknown>)] : [{ value: data }];
  if (!rows.length) return "(no rows)";
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r as object)))].filter((c) => wide || !/^(id|createdAt|updatedAt)$/.test(c) || rows.length === 1);
  const cell = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    if (typeof v === "number") return Number.isInteger(v) ? String(v) : money(v);
    if (typeof v === "object") return wide ? JSON.stringify(v) : Array.isArray(v) ? `[${v.length}]` : "{…}";
    const s = String(v);
    return wide || s.length <= 40 ? s : s.slice(0, 37) + "…";
  };
  const table = rows.map((r) => cols.map((c) => cell((r as Record<string, unknown>)[c])));
  const widths = cols.map((c, i) => Math.max(c.length, ...table.map((r) => r[i].length)));
  const line = (cells: string[]) => cells.map((v, i) => v.padEnd(widths[i])).join("  ").trimEnd();
  return [line(cols), line(widths.map((w) => "-".repeat(w))), ...table.map(line)].join("\n");
}
