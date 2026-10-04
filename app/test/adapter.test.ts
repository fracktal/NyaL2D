import { describe, expect, it } from "vitest";
import { ADAPTER_CONTRACT_VERSION, validateAdapterModule } from "../src/runtime/external-runtime";
import { adapterUrlFor } from "../src/runtime/registry";

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

describe("Ayagami wrapper", () => {
  it("is the slot's default and follows the contract while unconnected", async () => {
    expect(adapterUrlFor({ runtime: "ayagami", adapterUrls: {} }, "ayagami")).toBe("./adapters/ayagami-adapter.js");
    expect(adapterUrlFor({ runtime: "ayagami", adapterUrls: { ayagami: "./x.js" } }, "ayagami")).toBe("./x.js");
    expect(adapterUrlFor({ runtime: "iki", adapterUrls: {} }, "iki")).toBeUndefined();

    // @ts-expect-error plain JS adapter wrapper, no type declarations
    const mod = await import("../public/adapters/ayagami-adapter.js");
    const m = validateAdapterModule(mod);
    expect(m.meta.connected).toBe(false);
    const inst = await m.create({} as HTMLCanvasElement);
    for (const k of ["load", "parameters", "getParameter", "setParameter", "destroy"] as const) expect(typeof inst[k]).toBe("function");
    await expect(inst.load([])).rejects.toThrow(/연결되지 않았습니다/);
    expect(inst.parameters()).toEqual([]);
    inst.destroy();
  });
});
