/**
 * Expression variants: PSDTool `*` radio options (alternative eyes, mouths)
 * turned into drawings that swap by parameter, instead of being thrown away.
 *
 * The auto-rig deforms ONE drawing per role: it closes an eye by folding it
 * and opens a mouth by stretching it. A 立ち絵 PSD carries the artist's own
 * closed eye and mouth shapes as hidden alternatives, which read far better.
 * They become extra parts beside the role's part (same deformer, same mesh
 * layout, their own crop of the atlas) whose opacity follows the parameter
 * the rig already drives, so nothing about the rig changes and a model with no
 * variants comes out exactly as before.
 *
 * Everything here is pure: picking which option is which stage, and the
 * opacity bindings that do the swap. Pixels are handled by `layer-import.ts`.
 */

import type { IkiBinding, IkiModel, IkiPart, IkiUvRect } from "@ikijs/format";
import type { Box } from "./roles";

export type Stage = "eyeClosed" | "mouthRest" | "mouthMid" | "mouthOpen";

export interface VariantOption {
  name: string;
  /** The option the file shows by default. */
  chosen: boolean;
  /** Opaque box of the option's layers, canvas px; null when empty. */
  bbox: Box | null;
  /** Rig roles the option's layers were assigned. */
  roles: string[];
}

export interface VariantGroup {
  id: number;
  options: VariantOption[];
}

export interface StagePick {
  group: number;
  option: string;
  stage: Stage;
}

const EYE_FAMILY = /^(eye|iris|pupil|highlight|lash)_[LR]$/;
const CLOSED_EYE = /閉|closed?|wink|감은|감긴|감음/i;

function groupKind(g: VariantGroup): "eye" | "mouth" | undefined {
  const chosen = g.options.find((o) => o.chosen);
  if (!chosen || !chosen.roles.length) return undefined;
  if (chosen.roles.every((r) => EYE_FAMILY.test(r)) && chosen.roles.some((r) => r.startsWith("eye_"))) return "eye";
  if (chosen.roles.every((r) => r === "mouth")) return "mouth";
  return undefined;
}

/**
 * Pick, per group, which options fill which stage.
 *
 * Eyes: one closed eye, by name (閉じ目, closed, 감은 눈…), else the flattest
 * option when it is at most 0.6 of the default's height.
 *
 * Mouth: shapes ordered by drawn height, flattest = most closed. The flattest
 * becomes the rest shape (replacing the default when that is open, so the
 * model rests with its mouth shut), the tallest the open shape when it is at
 * least 1.5× the rest, and the one nearest halfway between, the mid shape.
 */
export function planVariants(groups: readonly VariantGroup[]): StagePick[] {
  const picks: StagePick[] = [];
  for (const g of groups) {
    const kind = groupKind(g);
    const chosen = g.options.find((o) => o.chosen)!;
    const drawn = g.options.filter((o) => o.bbox);
    if (kind === "eye" && chosen.bbox) {
      const others = drawn.filter((o) => !o.chosen);
      const named = others.filter((o) => CLOSED_EYE.test(o.name)).sort((a, b) => a.bbox!.h - b.bbox!.h || a.name.length - b.name.length);
      const flattest = [...others].sort((a, b) => a.bbox!.h - b.bbox!.h)[0];
      const closed = named[0] ?? (flattest && flattest.bbox!.h <= 0.6 * chosen.bbox.h ? flattest : undefined);
      if (closed) picks.push({ group: g.id, option: closed.name, stage: "eyeClosed" });
    } else if (kind === "mouth" && drawn.length > 1) {
      const byHeight = [...drawn].sort((a, b) => a.bbox!.h - b.bbox!.h || (a.chosen ? -1 : b.chosen ? 1 : 0));
      const rest = byHeight[0];
      const open = byHeight[byHeight.length - 1];
      if (open.bbox!.h < 1.5 * rest.bbox!.h) {
        // Too alike to be closed and open; keep the default as it is.
        continue;
      }
      if (!rest.chosen) picks.push({ group: g.id, option: rest.name, stage: "mouthRest" });
      const half = (rest.bbox!.h + open.bbox!.h) / 2;
      const mids = byHeight.filter((o) => o !== rest && o !== open && o.bbox!.h > 1.2 * rest.bbox!.h && o.bbox!.h < 0.85 * open.bbox!.h);
      const mid = mids.sort((a, b) => Math.abs(a.bbox!.h - half) - Math.abs(b.bbox!.h - half) || (a.chosen ? -1 : b.chosen ? 1 : 0))[0];
      if (mid) picks.push({ group: g.id, option: mid.name, stage: "mouthMid" });
      picks.push({ group: g.id, option: open.name, stage: "mouthOpen" });
    }
  }
  return picks;
}

/**
 * Opacity bindings that swap a stage in and the role's own drawing out.
 *
 * A binding maps the parameter's 0..1 linearly onto [from, to] and multiplies
 * opacity by it. Values below 0 leave the part fully transparent (the
 * renderer's output alpha clamps at 0), which is how a linear binding gets a
 * dead zone: `from: 1, to: -1/3` is the closed eye fully shown at EyeOpen 0,
 * gone from 0.75 up. Values are never above 1, and a part never carries two
 * bindings that can both be negative at once, whose product would be positive.
 */
export const STAGE_BINDINGS: Record<Stage | "eyeBase" | "mouthBase" | "mouthBaseNoMid" | "mouthOpenNoMid", { from: number; to: number }[]> = {
  /** The drawn closed eye: shown when the eye is shut, gone from 0.75 open. */
  eyeClosed: [{ from: 1, to: -1 / 3 }],
  /** The open eye (and its iris, lash…): gone below 0.25 open. */
  eyeBase: [{ from: -1 / 3, to: 1 }],
  /** Rest mouth part when a mid shape exists: gone from half open. */
  mouthBase: [{ from: 1, to: -1 }],
  mouthRest: [],
  /** Mid shape: 4t(1−t), full at half open, none at 0 and 1. */
  mouthMid: [{ from: 0, to: 2 }, { from: 2, to: 0 }],
  /** Open shape: from half open up. */
  mouthOpen: [{ from: -1, to: 1 }],
  /** Two shapes only: they overlap between 1/3 and 2/3 so the mouth never vanishes. */
  mouthBaseNoMid: [{ from: 1, to: -0.5 }],
  mouthOpenNoMid: [{ from: -0.5, to: 1 }],
};

export const EYE_PARAM: Record<"L" | "R", string> = { L: "ParamEyeLOpen", R: "ParamEyeROpen" };
export const MOUTH_PARAM = "ParamMouthOpenY";

/** A variant drawing placed in the atlas, ready to become a part. */
export interface VariantCrop {
  /** Base role it stands in for, e.g. "eye_L". */
  role: string;
  stage: Exclude<Stage, "mouthRest">;
  /** Crop box on the rig canvas, px, y down. */
  box: Box;
  /** Its rectangle in atlas texture 0. */
  uv: IkiUvRect;
}

/**
 * Add the variant parts and their bindings to a generated model, in place.
 * Each variant copies its role part's deformer and mesh layout (same unit
 * vertices, UVs moved into its own atlas rectangle) and draws just above it.
 * Variants whose role has no part, or whose parameter the model lacks, are
 * skipped. Returns the ids added.
 */
export function addVariantParts(model: IkiModel, crops: readonly VariantCrop[]): string[] {
  const W = model.canvas.width;
  const H = model.canvas.height;
  const params = new Set(model.parameters.map((p) => p.id));
  const byId = new Map(model.parts.map((p) => [p.id, p]));
  const added: IkiPart[] = [];
  const hasMid = crops.some((c) => c.stage === "mouthMid");
  const fadedBase = new Set<string>();

  const bind = (part: IkiPart, parameter: string, list: { from: number; to: number }[]) => {
    const b: IkiBinding[] = list.map((x) => ({ parameter, channel: "opacity", ...x }));
    part.bindings = [...(part.bindings ?? []), ...b];
  };

  for (const c of crops) {
    const base = byId.get(c.role);
    if (!base) continue;
    const side = c.role.endsWith("_L") ? "L" : "R";
    const parameter = c.stage === "eyeClosed" ? EYE_PARAM[side] : MOUTH_PARAM;
    if (!params.has(parameter)) continue;

    const part: IkiPart = {
      id: `${c.role}__${c.stage}`,
      color: [...base.color] as IkiPart["color"],
      width: c.box.w,
      height: c.box.h,
      transform: { x: c.box.x + c.box.w / 2 - W / 2, y: H / 2 - (c.box.y + c.box.h / 2) },
      order: base.order,
      texture: { index: 0, uv: c.uv },
    };
    if (base.deformer) part.deformer = base.deformer;
    if (base.mesh) part.mesh = { ...base.mesh, uvs: remapUvs(base.mesh.uvs, c.uv) };
    const list = c.stage === "mouthOpen" && !hasMid ? STAGE_BINDINGS.mouthOpenNoMid : STAGE_BINDINGS[c.stage];
    bind(part, parameter, list);
    added.push(part);

    // Fade the role's own drawing out, once per role.
    if (c.stage === "eyeClosed") {
      for (const p of model.parts) {
        if (EYE_FAMILY.test(p.id) && p.id.endsWith(`_${side}`) && !fadedBase.has(p.id)) {
          fadedBase.add(p.id);
          bind(p, parameter, STAGE_BINDINGS.eyeBase);
        }
      }
    } else if (!fadedBase.has(base.id)) {
      fadedBase.add(base.id);
      bind(base, parameter, hasMid ? STAGE_BINDINGS.mouthBase : STAGE_BINDINGS.mouthBaseNoMid);
    }
  }

  // Each variant draws right above its role: renumber paint order.
  const rank = (p: IkiPart) => ["mouthMid", "mouthOpen", "eyeClosed"].findIndex((s) => p.id.endsWith(`__${s}`));
  const all = [...model.parts, ...added].sort((a, b) => a.order - b.order || rank(a) - rank(b));
  all.forEach((p, i) => (p.order = i));
  model.parts = all;
  return added.map((p) => p.id);
}

/** Move a mesh's UVs from its own atlas rectangle into another, keeping each vertex's relative place. */
export function remapUvs(uvs: readonly number[], to: IkiUvRect): number[] {
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (let i = 0; i < uvs.length; i += 2) {
    u0 = Math.min(u0, uvs[i]);
    u1 = Math.max(u1, uvs[i]);
    v0 = Math.min(v0, uvs[i + 1]);
    v1 = Math.max(v1, uvs[i + 1]);
  }
  const du = u1 - u0 || 1;
  const dv = v1 - v0 || 1;
  return uvs.map((x, i) => (i % 2 === 0 ? to.x + ((x - u0) / du) * to.width : to.y + ((x - v0) / dv) * to.height));
}
