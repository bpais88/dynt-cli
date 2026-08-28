import { describe, expect, it } from "vitest";
import { parseRpc } from "../src/mcp.js";

describe("parseRpc", () => {
  it("reads plain JSON and SSE-framed responses", () => {
    expect(parseRpc('{"result":{"x":1}}')).toEqual({ result: { x: 1 } });
    expect(parseRpc('event: message\ndata: {"result":{"a":1}}\n\nevent: message\ndata: {"result":{"b":2}}\n')).toEqual({ result: { b: 2 } });
    expect(parseRpc("")).toBeNull();
  });
});
