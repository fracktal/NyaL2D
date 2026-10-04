import { SetPhysicsRig } from "@ikijs/editor";
import type { IkiPhysics } from "@ikijs/format";
import type { DeformerSummary, ModelSnapshot } from "../inspection/inspect";
import type { ModelSession } from "../model/model-session";
import type { RuntimeCapabilities } from "../runtime/types";
import { el, fmt } from "./dom";
import { iconEl } from "./icons";
import { responseChart, stepResponse } from "./physics-chart";
import { toast } from "./toast";

type Tab = "overview" | "physics" | "parts" | "deformers";
let activeTab: Tab = "physics";
const openItems = new Set<string>();

const tags = (xs: string[]) => (xs.length ? xs.map((x) => el("span", { class: "tag" }, x)) : [el("span", { class: "muted" }, "—")]);

function props(rows: [string, (Node | string)[] | string][]): HTMLElement {
  const dl = el("dl", { class: "props" });
  for (const [k, v] of rows) {
    const dd = el("dd");
    if (typeof v === "string") dd.textContent = v;
    else dd.append(...v);
    dl.append(el("dt", {}, k), dd);
  }
  return dl;
}

function treeItem(key: string, kind: string, label: string, meta: string, detail: HTMLElement, depth = 0): HTMLElement {
  const item = el("div", { class: openItems.has(key) ? "tree-item open" : "tree-item" });
  const row = el("button", { class: "tree-row", type: "button", "aria-expanded": String(openItems.has(key)) });
  row.style.paddingLeft = `${8 + depth * 14}px`;
  row.append(iconEl("chevron", "chev"), iconEl(kind, "kind"), el("span", { class: "label" }, label), el("span", { class: "meta" }, meta));
  row.addEventListener("click", () => {
    const open = item.classList.toggle("open");
    if (open) openItems.add(key);
    else openItems.delete(key);
    row.setAttribute("aria-expanded", String(open));
  });
  const d = el("div", { class: "tree-detail" }, detail);
  d.style.paddingLeft = `${34 + depth * 14}px`;
  item.append(row, d);
  return item;
}

function overview(snap: ModelSnapshot, session: ModelSession): HTMLElement[] {
  const stat = (n: number | string, label: string) => el("div", { class: "stat" }, el("b", {}, String(n)), el("span", {}, label));
  const kb = Math.round(snap.textures.reduce((a, t) => a + t.bytes, 0) / 1024);
  return [
    el(
      "div",
      { class: "section" },
      el("div", { class: "section-title" }, "Model"),
      el(
        "div",
        { class: "stats" },
        stat(snap.parameters.length, "parameters"),
        stat(snap.parts.length, "parts"),
        stat(snap.deformers.length, "deformers"),
        stat(snap.physics.length + snap.physicsChains.length, "physics rigs"),
        stat(snap.textures.length, "textures"),
        stat(session.changes.length, "changes"),
      ),
    ),
    el(
      "div",
      { class: "section" },
      el("div", { class: "section-title" }, "Document"),
      props([
        ["name", snap.name],
        ["format", `.iki v${snap.formatVersion}`],
        ["canvas", `${snap.canvas.width} × ${snap.canvas.height}`],
        ["textures", `${snap.textures.map((t) => t.mime.replace("image/", "")).join(", ") || "—"} · ~${kb} KB`],
        ["original", session.changes.length ? "보존됨 · 변경은 별도로 쌓임" : "변경 없음"],
      ]),
    ),
  ];
}

function physicsTab(snap: ModelSnapshot, session: ModelSession): HTMLElement[] {
  if (!snap.physics.length && !snap.physicsChains.length) {
    const e = el("div", { class: "empty" }, "이 모델에는 물리 리그가 없습니다");
    e.prepend(iconEl("wave"));
    return [e];
  }
  const out: HTMLElement[] = [];
  for (const r of snap.physics) {
    const rig = session.current.physics!.find((x) => x.id === r.id)!;
    const orig = session.original.physics?.find((x) => x.id === r.id);
    const cur = stepResponse(session.current, rig);
    const changed = orig && JSON.stringify(orig) !== JSON.stringify(rig);
    const ghost = changed ? stepResponse(session.original as never, orig as IkiPhysics) : undefined;

    const field = (key: "weight" | "scale" | "mass" | "stiffness" | "damping", label: string, value: number, origValue?: number) => {
      const input = el("input", { type: "text", inputmode: "decimal", value: String(value), "aria-label": `${r.id} ${label}` });
      const wrap = el("div", { class: origValue !== undefined && origValue !== value ? "field changed" : "field" }, el("label", {}, label), input);
      if (origValue !== undefined && origValue !== value) wrap.title = `원본 ${origValue}`;
      const commit = () => {
        const v = Number(input.value);
        if (input.value.trim() === "" || !Number.isFinite(v)) {
          input.setAttribute("aria-invalid", "true");
          return;
        }
        if (v === value) return;
        const next = structuredClone(rig) as IkiPhysics;
        if (key === "weight") next.input.weight = v;
        else if (key === "scale") next.output.scale = v;
        else next[key] = v;
        try {
          session.apply(new SetPhysicsRig(r.id, next), "inspector");
        } catch (err) {
          input.setAttribute("aria-invalid", "true");
          toast((err as Error).message, "error");
        }
      };
      input.addEventListener("input", () => input.removeAttribute("aria-invalid"));
      input.addEventListener("change", commit);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") {
          input.value = String(value);
          input.removeAttribute("aria-invalid");
        }
      });
      return wrap;
    };

    const metric = (label: string, v: string) => el("div", { class: "metric" }, el("b", {}, v), label);
    const card = el(
      "div",
      { class: "rig" },
      el("div", { class: "rig-head" }, iconEl("wave", "kind"), el("b", {}, r.id), changed ? el("span", { class: "badge accent" }, "수정됨") : null),
    );
    const flow = el("div", { class: "rig-flow" });
    flow.innerHTML = `${r.input} <span class="arrow">→</span> spring <span class="arrow">→</span> ${r.output}`;
    const legend = el("div", { class: "chart-legend" }, el("span", {}, el("i"), "현재"), ghost ? el("span", {}, el("i", { class: "ghost" }), "원본") : null, el("span", {}, `계단 입력: ${r.input} 기본값 → 최대`));
    card.append(
      flow,
      responseChart(cur, ghost),
      legend,
      el(
        "div",
        { class: "metrics" },
        metric("최대", fmt(cur.peak)),
        metric("오버슈트", `${Math.round(cur.overshoot * 100)}%`),
        metric("정착 (±5%)", cur.settleMs === null ? "> 2.5s" : `${(cur.settleMs / 1000).toFixed(2)}s`),
      ),
      el(
        "div",
        { class: "fields" },
        field("stiffness", "stiffness", r.stiffness, orig?.stiffness),
        field("damping", "damping", r.damping, orig?.damping),
        field("mass", "mass", r.mass, orig?.mass),
        field("scale", "output scale", r.scale, orig?.output.scale),
        field("weight", "input weight", r.weight, orig?.input.weight),
      ),
    );
    out.push(card);
  }
  for (const c of snap.physicsChains) {
    out.push(
      el(
        "div",
        { class: "rig" },
        el("div", { class: "rig-head" }, iconEl("link", "kind"), el("b", {}, c.id), el("span", { class: "badge" }, "chain · 읽기 전용")),
        props([
          ["anchor", c.anchorDeformer],
          ["gravity", `${c.gravity.angle}° × ${c.gravity.strength}`],
          ["segments", tags(c.segments.map((s) => s.output))],
        ]),
      ),
    );
  }
  return out;
}

function partsTab(snap: ModelSnapshot): HTMLElement[] {
  const wrap = el("div", { style: "padding:6px 0" });
  for (const p of [...snap.parts].sort((a, b) => b.order - a.order)) {
    wrap.append(
      treeItem(
        `part:${p.id}`,
        p.kind === "mesh" ? "grid" : "image",
        p.id,
        `#${p.order}`,
        props([
          ["geometry", p.kind === "mesh" ? `mesh · ${p.vertexCount} vertices` : "quad"],
          ["deformer", p.deformer ?? "—"],
          ["texture", p.textured ? "atlas" : "solid color"],
          ["bindings", tags(p.bindings)],
          ["warps", tags(p.warpParameters)],
          ["clip", tags(p.clipMasks)],
        ]),
      ),
    );
  }
  return [wrap];
}

function deformersTab(snap: ModelSnapshot): HTMLElement[] {
  if (!snap.deformers.length) return [el("div", { class: "empty" }, "디포머가 없습니다")];
  const wrap = el("div", { style: "padding:6px 0" });
  const byParent = new Map<string | undefined, DeformerSummary[]>();
  for (const d of snap.deformers) {
    const k = d.parent && snap.deformers.some((x) => x.id === d.parent) ? d.parent : undefined;
    byParent.set(k, [...(byParent.get(k) ?? []), d]);
  }
  const walk = (parent: string | undefined, depth: number) => {
    for (const d of byParent.get(parent) ?? []) {
      const parts = d.children.filter((c) => c.startsWith("part:")).map((c) => c.slice(5));
      wrap.append(
        treeItem(
          `def:${d.id}`,
          d.kind === "warp" ? "grid" : "pivot",
          d.id,
          d.kind === "warp" ? `warp ${d.grid!.cols}×${d.grid!.rows}` : "matrix",
          props([
            ["bindings", tags(d.bindings)],
            ["warp params", tags(d.warpParameters)],
            ["parts", tags(parts)],
          ]),
          depth,
        ),
      );
      walk(d.id, depth + 1);
    }
  };
  walk(undefined, 0);
  return [wrap];
}

/** Tabbed inspector. Physics numbers are editable as reversible changes. */
export function renderInspector(tabsRoot: HTMLElement, root: HTMLElement, snap: ModelSnapshot, session: ModelSession): void {
  const tabs: [Tab, string, number | null][] = [
    ["overview", "개요", null],
    ["physics", "물리", snap.physics.length + snap.physicsChains.length],
    ["parts", "파트", snap.parts.length],
    ["deformers", "디포머", snap.deformers.length],
  ];
  tabsRoot.replaceChildren(
    ...tabs.map(([id, label, n]) => {
      const b = el("button", { class: "tab", role: "tab", type: "button", "aria-selected": String(id === activeTab) }, label, n !== null ? el("span", { class: "n" }, String(n)) : null);
      b.addEventListener("click", () => {
        activeTab = id;
        renderInspector(tabsRoot, root, snap, session);
      });
      return b;
    }),
  );
  const scroll = root.scrollTop;
  const body =
    activeTab === "overview" ? overview(snap, session) : activeTab === "physics" ? physicsTab(snap, session) : activeTab === "parts" ? partsTab(snap) : deformersTab(snap);
  root.replaceChildren(...body);
  root.scrollTop = scroll;
}


/** Inspector for a runtime that only exposes parameters (external adapters). */
export function renderRuntimeInspector(
  tabsRoot: HTMLElement,
  root: HTMLElement,
  info: { runtime: string; adapter?: string; connected?: boolean; model?: string; parameters: number; capabilities: RuntimeCapabilities },
): void {
  tabsRoot.replaceChildren(el("button", { class: "tab", role: "tab", type: "button", "aria-selected": "true" }, "개요"));
  const cap = (ok: boolean, label: string) => {
    const li = el("li", { class: ok ? "yes" : "no" }, iconEl(ok ? "check" : "close"), label);
    return li;
  };
  const c = info.capabilities;
  root.replaceChildren(
    el(
      "div",
      { class: "section" },
      el("div", { class: "section-title" }, "Runtime"),
      props([
        ["runtime", info.runtime],
        ["adapter", info.adapter ?? "—"],
        ["status", info.connected === false ? "미연결 · 빈 래퍼" : "연결됨"],
        ["model", info.model ?? "열린 모델 없음"],
        ["parameters", String(info.parameters)],
      ]),
    ),
    el(
      "div",
      { class: "section" },
      el("div", { class: "section-title" }, "Capabilities"),
      el(
        "ul",
        { class: "cap-list" },
        cap(true, "파라미터 읽기·쓰기"),
        cap(true, "렌더링과 프레임 캡처"),
        cap(c.motionModes.some((m) => m !== "off"), `모션 (${c.motionModes.filter((m) => m !== "off").join(", ") || "없음"})`),
        cap(c.inspection === "full", "파트·디포머·물리 구조 조회"),
        cap(c.editing, "모델 편집과 되돌리기"),
        cap(c.physicsSimulation, "헤드리스 물리 시뮬레이션"),
      ),
    ),
    el(
      "div",
      { class: "notice" },
      el("b", {}, "블랙박스 런타임"),
      "이 런타임은 어댑터 규약의 함수만 노출합니다. 모델 구조 조회와 편집은 내장 Iki 런타임에서만 가능합니다.",
    ),
  );
}
