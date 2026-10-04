import type { IkiModel } from "@ikijs/format";

/**
 * A plain, JSON-serializable summary of a `.iki` model.
 *
 * Built only from fields the `.iki` format actually declares, so it is the
 * same view a human sees in the inspector and an agent will later receive as
 * an observation. Heavy arrays (mesh vertices, keyform offsets, texture data)
 * are reduced to counts.
 */
export interface ModelSnapshot {
  name: string;
  formatVersion: number;
  canvas: { width: number; height: number };
  parameters: ParameterSummary[];
  parts: PartSummary[];
  deformers: DeformerSummary[];
  physics: PhysicsSummary[];
  physicsChains: ChainSummary[];
  textures: TextureSummary[];
}

export interface ParameterSummary {
  id: string;
  name?: string;
  min: number;
  max: number;
  default: number;
  /** Parts and deformers whose bindings or warps read this parameter. */
  usedBy: string[];
  /** Physics rigs / chains that write this parameter. */
  drivenBy: string[];
}

export interface PartSummary {
  id: string;
  order: number;
  deformer?: string;
  kind: "quad" | "mesh";
  vertexCount?: number;
  textured: boolean;
  bindings: string[];
  warpParameters: string[];
  clipMasks: string[];
}

export interface DeformerSummary {
  id: string;
  kind: "matrix" | "warp";
  parent?: string;
  bindings: string[];
  /** Warp deformers only: grid size in cells and driving parameters. */
  grid?: { cols: number; rows: number };
  warpParameters: string[];
  children: string[];
}

export interface PhysicsSummary {
  id: string;
  input: string;
  weight: number;
  output: string;
  scale: number;
  mass: number;
  stiffness: number;
  damping: number;
}

export interface ChainSummary {
  id: string;
  anchorDeformer: string;
  gravity: { angle: number; strength: number };
  segments: { output: string; mass: number; stiffness: number; damping: number }[];
}

export interface TextureSummary {
  index: number;
  mime: string;
  bytes: number;
}

const fmtBinding = (b: { parameter: string; channel: string; from: number; to: number }) =>
  `${b.parameter} → ${b.channel} [${b.from}, ${b.to}]`;

export function inspectModel(model: IkiModel): ModelSnapshot {
  const usedBy = new Map<string, Set<string>>();
  const drivenBy = new Map<string, Set<string>>();
  const note = (map: Map<string, Set<string>>, param: string, who: string) => {
    if (!map.has(param)) map.set(param, new Set());
    map.get(param)!.add(who);
  };

  const parts: PartSummary[] = model.parts.map((p) => {
    for (const b of p.bindings ?? []) note(usedBy, b.parameter, `part:${p.id}`);
    for (const w of p.warps ?? []) note(usedBy, w.parameter, `part:${p.id}`);
    return {
      id: p.id,
      order: p.order,
      deformer: p.deformer,
      kind: p.mesh ? "mesh" : "quad",
      vertexCount: p.mesh ? p.mesh.vertices.length / 2 : undefined,
      textured: p.texture !== undefined,
      bindings: (p.bindings ?? []).map(fmtBinding),
      warpParameters: (p.warps ?? []).map((w) => w.parameter),
      clipMasks: p.clip?.masks ?? [],
    };
  });

  const deformers: DeformerSummary[] = (model.deformers ?? []).map((d) => {
    const children = [
      ...(model.deformers ?? []).filter((c) => c.parent === d.id).map((c) => `deformer:${c.id}`),
      ...model.parts.filter((p) => p.deformer === d.id).map((p) => `part:${p.id}`),
    ];
    if (d.kind === "warp") {
      const warpParameters = [
        ...(d.warps ?? []).map((w) => w.parameter),
        ...(d.warp2d ? [d.warp2d.parameter, d.warp2d.parameterY] : []),
      ];
      for (const id of warpParameters) note(usedBy, id, `deformer:${d.id}`);
      return {
        id: d.id,
        kind: "warp",
        parent: d.parent,
        bindings: [],
        grid: { cols: d.grid.cols, rows: d.grid.rows },
        warpParameters,
        children,
      };
    }
    for (const b of d.bindings ?? []) note(usedBy, b.parameter, `deformer:${d.id}`);
    return {
      id: d.id,
      kind: "matrix",
      parent: d.parent,
      bindings: (d.bindings ?? []).map(fmtBinding),
      warpParameters: [],
      children,
    };
  });

  const physics: PhysicsSummary[] = (model.physics ?? []).map((r) => {
    note(drivenBy, r.output.parameter, `physics:${r.id}`);
    return {
      id: r.id,
      input: r.input.parameter,
      weight: r.input.weight,
      output: r.output.parameter,
      scale: r.output.scale,
      mass: r.mass,
      stiffness: r.stiffness,
      damping: r.damping,
    };
  });

  const physicsChains: ChainSummary[] = (model.physicsChains ?? []).map((c) => {
    for (const s of c.segments) note(drivenBy, s.output.parameter, `chain:${c.id}`);
    return {
      id: c.id,
      anchorDeformer: c.anchorDeformer,
      gravity: c.gravity,
      segments: c.segments.map((s) => ({
        output: s.output.parameter,
        mass: s.mass,
        stiffness: s.stiffness,
        damping: s.damping,
      })),
    };
  });

  const textures: TextureSummary[] = (model.textures ?? []).map((t, index) => {
    const m = /^data:([^;,]+)/.exec(t.source);
    const comma = t.source.indexOf(",");
    // Base64 payload length → decoded byte estimate.
    const bytes = comma >= 0 ? Math.floor(((t.source.length - comma - 1) * 3) / 4) : 0;
    return { index, mime: m?.[1] ?? "unknown", bytes };
  });

  return {
    name: model.name,
    formatVersion: model.version,
    canvas: { ...model.canvas },
    parameters: model.parameters.map((p) => ({
      id: p.id,
      name: p.name,
      min: p.min,
      max: p.max,
      default: p.default,
      usedBy: [...(usedBy.get(p.id) ?? [])],
      drivenBy: [...(drivenBy.get(p.id) ?? [])],
    })),
    parts,
    deformers,
    physics,
    physicsChains,
    textures,
  };
}
