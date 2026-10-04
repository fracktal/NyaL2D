import { SetPhysicsRig } from "@ikijs/editor";
import type { IkiPhysics } from "@ikijs/format";
import type { ModelSnapshot } from "../inspection/inspect";
import type { ModelSession } from "../model/model-session";
import { el } from "./dom";

function kv(rows: [string, Node | string][]): HTMLElement {
  const dl = el("dl", { class: "kv" });
  for (const [k, v] of rows) dl.append(el("dt", {}, k), el("dd", {}, v));
  return dl;
}

function section(title: string, count: number, items: HTMLElement[], open = false): HTMLElement {
  const d = el("details", {}, el("summary", {}, `${title} (${count})`), ...items);
  d.open = open;
  return d;
}

const list = (xs: string[]) => (xs.length ? xs.join(", ") : "—");

/**
 * Renders the model snapshot. Physics rig numbers are editable; each edit is
 * applied as a reversible change on the session (never on the original).
 */
export function renderInspector(root: HTMLElement, snap: ModelSnapshot, session: ModelSession): void {
  const openState = new Map<string, boolean>();
  for (const d of root.querySelectorAll(":scope > details")) {
    openState.set(d.querySelector("summary")?.textContent?.split(" (")[0] ?? "", (d as HTMLDetailsElement).open);
  }
  const isOpen = (title: string, dflt = false) => openState.get(title) ?? dflt;

  const model = kv([
    ["name", snap.name],
    ["format", `v${snap.formatVersion}`],
    ["canvas", `${snap.canvas.width} × ${snap.canvas.height}`],
  ]);

  const params = snap.parameters.map((p) =>
    el(
      "details",
      {},
      el("summary", {}, p.id),
      kv([
        ["range", `[${p.min}, ${p.max}] default ${p.default}`],
        ["used by", list(p.usedBy)],
        ["driven by", list(p.drivenBy)],
      ]),
    ),
  );

  const parts = [...snap.parts]
    .sort((a, b) => b.order - a.order)
    .map((p) =>
      el(
        "details",
        {},
        el("summary", {}, `${p.id} `, el("span", { class: "muted" }, `#${p.order} ${p.kind}`)),
        kv([
          ["deformer", p.deformer ?? "—"],
          ["vertices", p.vertexCount !== undefined ? String(p.vertexCount) : "quad"],
          ["textured", p.textured ? "yes" : "no"],
          ["bindings", list(p.bindings)],
          ["warps", list(p.warpParameters)],
          ["clip", list(p.clipMasks)],
        ]),
      ),
    );

  const deformers = snap.deformers.map((d) =>
    el(
      "details",
      {},
      el("summary", {}, `${d.id} `, el("span", { class: "muted" }, d.kind)),
      kv([
        ["parent", d.parent ?? "—"],
        ["bindings", list(d.bindings)],
        ["grid", d.grid ? `${d.grid.cols}×${d.grid.rows} cells` : "—"],
        ["warps", list(d.warpParameters)],
        ["children", list(d.children)],
      ]),
    ),
  );

  const physics = snap.physics.map((r) => {
    const field = (key: "mass" | "stiffness" | "damping" | "weight" | "scale", value: number) => {
      const input = el("input", { type: "number", step: "any", value: String(value) });
      input.addEventListener("change", () => {
        const rig = structuredClone(session.current.physics!.find((x) => x.id === r.id)!) as IkiPhysics;
        const v = Number(input.value);
        const before = key === "weight" ? rig.input.weight : key === "scale" ? rig.output.scale : rig[key];
        if (v === before) return;
        if (key === "weight") rig.input.weight = v;
        else if (key === "scale") rig.output.scale = v;
        else rig[key] = v;
        try {
          session.apply(new SetPhysicsRig(r.id, rig), "inspector");
        } catch (err) {
          input.value = String(value);
          alert((err as Error).message);
        }
      });
      return input;
    };
    return el(
      "details",
      { open: "" },
      el("summary", {}, r.id),
      kv([
        ["input", `${r.input} × `],
        ["weight", field("weight", r.weight)],
        ["output", r.output],
        ["scale", field("scale", r.scale)],
        ["mass", field("mass", r.mass)],
        ["stiffness", field("stiffness", r.stiffness)],
        ["damping", field("damping", r.damping)],
      ]),
    );
  });

  const chains = snap.physicsChains.map((c) =>
    el(
      "details",
      {},
      el("summary", {}, c.id),
      kv([
        ["anchor", c.anchorDeformer],
        ["gravity", `${c.gravity.angle}° × ${c.gravity.strength}`],
        ["segments", c.segments.map((s) => s.output).join(" → ")],
      ]),
    ),
  );

  const textures = snap.textures.map((t) =>
    kv([[`#${t.index}`, `${t.mime}, ~${Math.round(t.bytes / 1024)} KB`]]),
  );

  root.replaceChildren(
    section("Model", 1, [model], isOpen("Model", true)),
    section("Parameters", snap.parameters.length, params, isOpen("Parameters")),
    section("Parts", snap.parts.length, parts, isOpen("Parts")),
    section("Deformers", snap.deformers.length, deformers, isOpen("Deformers")),
    section("Physics", snap.physics.length, physics, isOpen("Physics", true)),
    section("Physics chains", snap.physicsChains.length, chains, isOpen("Physics chains")),
    section("Textures", snap.textures.length, textures, isOpen("Textures")),
  );
}
