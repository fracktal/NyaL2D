import { readFileSync } from "node:fs";
import { parseIkiModel, type IkiModel, type IkiPart } from "@ikijs/format";
import { describe, expect, it } from "vitest";
import { addVariantParts, planVariants, remapUvs, STAGE_BINDINGS, type VariantGroup, type VariantOption } from "../src/import/variants";

const box = (h: number, y = 300) => ({ x: 400, y, w: 200, h });
const opt = (name: string, h: number, roles: string[], chosen = false): VariantOption => ({ name, chosen, bbox: box(h), roles });
const EYES = ["eye_L", "eye_R"];

// Heights as in ずんだもん 立ち絵素材 V3.2 (全部詰め版), front-facing head.
const zundaEyes: VariantGroup = {
  id: 0,
  options: [opt("基本目", 111, EYES, true), opt("基本目→", 111, EYES), opt("ジト目", 97, EYES), opt("細め目", 99, EYES), opt("閉じ目", 43, EYES), opt("にっこり", 40, EYES), opt("UU", 50, EYES)],
};
const zundaMouth: VariantGroup = {
  id: 1,
  options: [opt("むふ", 20, ["mouth"]), opt("えへ", 35, ["mouth"]), opt("ほあ", 48, ["mouth"]), opt("ほう", 61, ["mouth"], true), opt("ほあー", 66, ["mouth"]), opt("ほほえみ", 26, ["mouth"]), opt("ん", 12, ["mouth"]), opt("うわー", 57, ["mouth"])],
};
const zundaBrows: VariantGroup = { id: 2, options: [opt("怒り眉", 32, ["brow_L", "brow_R"], true), opt("困り眉", 30, ["brow_L", "brow_R"])] };

describe("planVariants", () => {
  it("picks the named closed eye over a flatter happy-closed one", () => {
    expect(planVariants([zundaEyes])).toEqual([{ group: 0, option: "閉じ目", stage: "eyeClosed" }]);
  });

  it("falls back to the flattest eye only when it is clearly flatter", () => {
    const g: VariantGroup = { id: 0, options: [opt("a", 100, EYES, true), opt("b", 90, EYES), opt("c", 55, EYES)] };
    expect(planVariants([g])).toEqual([{ group: 0, option: "c", stage: "eyeClosed" }]);
    const none: VariantGroup = { id: 0, options: [opt("a", 100, EYES, true), opt("b", 90, EYES)] };
    expect(planVariants([none])).toEqual([]);
  });

  it("rests the mouth on its flattest shape and opens through a mid to the tallest", () => {
    expect(planVariants([zundaMouth])).toEqual([
      { group: 1, option: "ん", stage: "mouthRest" },
      { group: 1, option: "えへ", stage: "mouthMid" },
      { group: 1, option: "ほあー", stage: "mouthOpen" },
    ]);
  });

  it("keeps the default mouth as rest when it is already the flattest", () => {
    const g: VariantGroup = { id: 3, options: [opt("closed", 10, ["mouth"], true), opt("open", 40, ["mouth"])] };
    expect(planVariants([g])).toEqual([{ group: 3, option: "open", stage: "mouthOpen" }]);
  });

  it("leaves groups alone that are not eyes or mouths, or whose shapes are alike", () => {
    const alike: VariantGroup = { id: 4, options: [opt("a", 30, ["mouth"], true), opt("b", 35, ["mouth"])] };
    const head: VariantGroup = { id: 5, options: [opt("正面", 400, ["face", "eye_L", "eye_R", "mouth"], true), opt("上向き", 400, ["face", "eye_L", "eye_R", "mouth"])] };
    expect(planVariants([zundaBrows, alike, head])).toEqual([]);
  });
});

/** Opacity a part's bindings give at parameter value t (0..1), as the engine multiplies them, then the GPU clamps. */
function opacityAt(part: IkiPart, parameter: string, t: number): number {
  let o = part.transform.opacity ?? 1;
  for (const b of part.bindings ?? []) if (b.channel === "opacity" && b.parameter === parameter) o *= b.from + (b.to - b.from) * t;
  return Math.min(1, Math.max(0, o));
}

describe("stage bindings", () => {
  const part = (list: { from: number; to: number }[], parameter = "P"): IkiPart =>
    ({ id: "x", color: [1, 1, 1, 1], width: 1, height: 1, transform: { x: 0, y: 0 }, order: 0, bindings: list.map((b) => ({ parameter, channel: "opacity", ...b })) }) as IkiPart;
  const ts = Array.from({ length: 21 }, (_, i) => i / 20);

  it("never ask for opacity above 1", () => {
    for (const list of Object.values(STAGE_BINDINGS)) for (const t of ts) expect(list.reduce((o, b) => o * (b.from + (b.to - b.from) * t), 1)).toBeLessThanOrEqual(1 + 1e-9);
  });

  it("shows only the open eye when open and only the drawn closed eye when shut, and never neither", () => {
    const base = part(STAGE_BINDINGS.eyeBase);
    const closed = part(STAGE_BINDINGS.eyeClosed);
    expect([opacityAt(base, "P", 1), opacityAt(closed, "P", 1)]).toEqual([1, 0]);
    expect([opacityAt(base, "P", 0), opacityAt(closed, "P", 0)]).toEqual([0, 1]);
    for (const t of ts) expect(opacityAt(base, "P", t) + opacityAt(closed, "P", t)).toBeGreaterThan(0.3);
  });

  it("steps the mouth rest → mid → open with something always drawn", () => {
    const rest = part(STAGE_BINDINGS.mouthBase);
    const mid = part(STAGE_BINDINGS.mouthMid);
    const open = part(STAGE_BINDINGS.mouthOpen);
    const at = (t: number) => [rest, mid, open].map((p) => opacityAt(p, "P", t));
    expect(at(0)).toEqual([1, 0, 0]);
    expect(at(0.5)).toEqual([0, 1, 0]);
    expect(at(1)).toEqual([0, 0, 1]);
    for (const t of ts) expect(Math.max(...at(t))).toBeGreaterThan(0.45);
  });

  it("overlaps two mouth shapes so the mouth never vanishes", () => {
    const rest = part(STAGE_BINDINGS.mouthBaseNoMid);
    const open = part(STAGE_BINDINGS.mouthOpenNoMid);
    for (const t of ts) expect(opacityAt(rest, "P", t) + opacityAt(open, "P", t)).toBeGreaterThan(0.3);
    expect([opacityAt(rest, "P", 0), opacityAt(open, "P", 1)]).toEqual([1, 1]);
  });
});

describe("addVariantParts", () => {
  const hero = (): IkiModel => parseIkiModel(JSON.parse(readFileSync(new URL("../public/models/hero.iki", import.meta.url), "utf8")));
  const uv = { x: 0.5, y: 0.5, width: 0.1, height: 0.05 };

  it("adds closed eyes and mouth shapes beside their roles, with swap bindings, and stays valid", () => {
    const m = hero();
    const added = addVariantParts(m, [
      { role: "eye_L", stage: "eyeClosed", box: { x: 600, y: 380, w: 100, h: 30 }, uv },
      { role: "eye_R", stage: "eyeClosed", box: { x: 400, y: 380, w: 100, h: 30 }, uv },
      { role: "mouth", stage: "mouthMid", box: { x: 520, y: 590, w: 60, h: 30 }, uv },
      { role: "mouth", stage: "mouthOpen", box: { x: 515, y: 585, w: 70, h: 45 }, uv },
    ]);
    expect(added).toEqual(["eye_L__eyeClosed", "eye_R__eyeClosed", "mouth__mouthMid", "mouth__mouthOpen"]);
    const valid = parseIkiModel(m);
    const p = (id: string) => valid.parts.find((x) => x.id === id)!;

    // Same deformer and mesh layout as the role, its own place and UVs.
    expect(p("eye_L__eyeClosed").deformer).toBe(p("eye_L").deformer);
    expect(p("eye_L__eyeClosed").mesh!.vertices).toEqual(p("eye_L").mesh!.vertices);
    expect(p("eye_L__eyeClosed").warps).toBeUndefined();
    expect(p("eye_L__eyeClosed").transform).toEqual({ x: 650 - 550, y: 550 - 395 });
    const u = p("eye_L__eyeClosed").mesh!.uvs.filter((_, i) => i % 2 === 0);
    expect(Math.min(...u)).toBeCloseTo(0.5);
    expect(Math.max(...u)).toBeCloseTo(0.6);

    // Drawn right above the role.
    expect(p("eye_L__eyeClosed").order).toBe(p("eye_L").order + 1);
    expect(p("mouth__mouthOpen").order).toBe(p("mouth__mouthMid").order + 1);

    // The whole left eye fades on ParamEyeLOpen; the right side is untouched by it.
    for (const id of ["eye_L", "iris_L", "lash_L"]) expect(opacityAt(p(id), "ParamEyeLOpen", 0)).toBe(0);
    expect(opacityAt(p("eye_R"), "ParamEyeLOpen", 0)).toBe(1);
    expect(opacityAt(p("eye_L__eyeClosed"), "ParamEyeLOpen", 0)).toBe(1);
    expect(opacityAt(p("mouth"), "ParamMouthOpenY", 1)).toBe(0);
    expect(opacityAt(p("mouth__mouthOpen"), "ParamMouthOpenY", 1)).toBe(1);
  });

  it("skips variants whose role the model does not have", () => {
    const m = hero();
    m.parts = m.parts.filter((x) => x.id !== "eye_L" && !x.clip);
    expect(addVariantParts(m, [{ role: "eye_L", stage: "eyeClosed", box: { x: 0, y: 0, w: 10, h: 10 }, uv }])).toEqual([]);
  });
});

describe("remapUvs", () => {
  it("keeps each vertex's place within the rectangle", () => {
    expect(remapUvs([0.2, 0.4, 0.3, 0.4, 0.2, 0.5, 0.3, 0.5], { x: 0, y: 0.5, width: 0.5, height: 0.25 })).toEqual([0, 0.5, 0.5, 0.5, 0, 0.75, 0.5, 0.75]);
  });
});
