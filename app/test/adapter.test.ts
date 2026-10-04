import { describe, expect, it } from "vitest";
import { ADAPTER_CONTRACT_VERSION, validateAdapterModule } from "../src/runtime/external-runtime";

const ok = { nyal2dAdapter: ADAPTER_CONTRACT_VERSION, meta: { name: "x" }, create: () => ({}) };

describe("validateAdapterModule", () => {
  it("accepts a module that follows the contract", () => {
    expect(validateAdapterModule(ok).meta.name).toBe("x");
  });

  it.each([
    [{ ...ok, nyal2dAdapter: 2 }, /nyal2dAdapter = 2/],
    [{ ...ok, meta: {} }, /meta.name/],
    [{ ...ok, create: undefined }, /create/],
    [null, /비어/],
  ])("rejects %o", (mod, msg) => {
    expect(() => validateAdapterModule(mod)).toThrow(msg);
  });

  it("accepts the bundled example adapter", async () => {
    // @ts-expect-error plain JS reference adapter, no type declarations
    const mod = await import("../public/adapters/example-adapter.js");
    expect(validateAdapterModule(mod).meta.name).toBe("Example adapter");
  });
});
