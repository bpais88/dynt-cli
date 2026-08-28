/** Tool catalogue types (mirror of GET /v1/public/agent-tools/spec). */
export interface SpecTool {
  name: string; resource: string; alias: string; title: string; description: string;
  access: "read" | "write" | "email:read" | "email:write";
  platforms: string[];
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean };
  inputSchema: { type?: string; properties?: Record<string, JsonSchemaProp>; required?: string[] };
}
export interface JsonSchemaProp {
  type?: string | string[]; description?: string; enum?: (string | number)[]; default?: unknown;
  minimum?: number; maximum?: number; items?: JsonSchemaProp; anyOf?: JsonSchemaProp[]; format?: string;
}
export interface Spec { name: string; version: string; hash: string; instructions: string; tools: SpecTool[] }

export const DEFAULT_ENVIRONMENTS = {
  production: { api: "https://api.dynt.ai", app: "https://app.dynt.ai", auth: "https://hlovaeepcjkqjjejnzuy.supabase.co/auth/v1" },
  sandbox: { api: "https://dynt-server-sandbox.onrender.com", app: "https://dynt-app-sandbox.onrender.com", auth: "https://cwdtwneqsbzlknktolav.supabase.co/auth/v1" },
} as const;
export type EnvName = keyof typeof DEFAULT_ENVIRONMENTS;

/** Only tools the catalogue marks for the CLI platform, grouped by resource. */
export function cliTools(spec: Spec): Map<string, SpecTool[]> {
  const byResource = new Map<string, SpecTool[]>();
  for (const t of spec.tools) {
    if (!t.platforms.includes("cli")) continue;
    const list = byResource.get(t.resource) ?? [];
    list.push(t);
    byResource.set(t.resource, list);
  }
  for (const list of byResource.values()) list.sort((a, b) => a.alias.localeCompare(b.alias));
  return new Map([...byResource.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

export interface OptionSpec { flag: string; name: string; description: string; required: boolean; kind: "string" | "number" | "boolean" | "array" | "json"; choices?: string[] }

/** Map a tool's JSON Schema inputs to CLI options. Flag names are the exact schema field names. */
export function optionsFor(tool: SpecTool): OptionSpec[] {
  const props = tool.inputSchema.properties ?? {};
  const required = new Set(tool.inputSchema.required ?? []);
  return Object.entries(props).map(([name, p]) => {
    const type = Array.isArray(p.type) ? p.type.find((t) => t !== "null") : p.type;
    let kind: OptionSpec["kind"] = "string";
    if (p.enum) kind = "string";
    else if (type === "number" || type === "integer") kind = "number";
    else if (type === "boolean") kind = "boolean";
    else if (type === "array") kind = "array";
    else if (type === "object" || p.anyOf) kind = "json";
    const flag = kind === "boolean" ? `--${name}` : `--${name} <value>`;
    const bits = [p.description ?? ""];
    if (p.enum) bits.push(`one of: ${p.enum.join(", ")}`);
    if (p.default !== undefined) bits.push(`default: ${JSON.stringify(p.default)}`);
    return { flag, name, description: bits.filter(Boolean).join(". "), required: required.has(name), kind, choices: p.enum?.map(String) };
  });
}

/** Coerce parsed CLI option values into the JSON the tool expects. */
export function coerceArguments(tool: SpecTool, raw: Record<string, unknown>, jsonBody?: string): Record<string, unknown> {
  const out: Record<string, unknown> = jsonBody ? JSON.parse(jsonBody) : {};
  for (const opt of optionsFor(tool)) {
    const v = raw[opt.name];
    if (v === undefined) continue;
    switch (opt.kind) {
      case "number": { const n = Number(v); if (Number.isNaN(n)) throw new Error(`--${opt.name} must be a number`); out[opt.name] = n; break; }
      case "boolean": out[opt.name] = Boolean(v); break;
      case "array": out[opt.name] = String(v).split(",").map((s) => s.trim()).filter(Boolean); break;
      case "json": out[opt.name] = typeof v === "string" ? JSON.parse(v) : v; break;
      default:
        if (opt.choices && !opt.choices.includes(String(v))) throw new Error(`--${opt.name} must be one of: ${opt.choices.join(", ")}`);
        out[opt.name] = String(v);
    }
  }
  return out;
}
