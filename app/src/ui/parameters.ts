import { StandardParameter as SP } from "@ikijs/format";
import type { ModelSnapshot } from "../inspection/inspect";
import type { IkiRuntime } from "../runtime/iki-runtime";
import { el, fmt } from "./dom";
import { icon } from "./icons";

const GROUPS: [string, string[]][] = [
  ["Head", [SP.AngleX, SP.AngleY, SP.AngleZ]],
  ["Eyes", [SP.EyeOpenLeft, SP.EyeOpenRight, SP.EyeballX, SP.EyeballY]],
  ["Brows", [SP.BrowLeftY, SP.BrowLeftAngle, SP.BrowRightY, SP.BrowRightAngle]],
  ["Mouth", [SP.MouthOpen, SP.MouthForm]],
  ["Body", [SP.Breath]],
];

const collapsed = new Set<string>();

export interface ParameterPanel {
  /** Reflect a value written elsewhere (motion drivers, agent, reset). */
  update(id: string, value: number): void;
}

/**
 * Grouped parameter sliders. Values are batched to one DOM write per frame,
 * because the motion drivers write ~10 parameters every frame.
 */
export function renderParameters(
  root: HTMLElement,
  runtime: IkiRuntime,
  snap: ModelSnapshot,
  filter: string,
): ParameterPanel {
  root.replaceChildren();
  const drivenByMotion = new Set(runtime.drivenParameterIds);
  const physicsOut = new Set(snap.parameters.filter((p) => p.drivenBy.length).map((p) => p.id));
  const params = runtime.getParameters();
  const q = filter.trim().toLowerCase();
  const visible = params.filter((p) => !q || p.id.toLowerCase().includes(q) || (p.name ?? "").toLowerCase().includes(q));

  const grouped = new Map<string, typeof params>();
  const placed = new Set<string>();
  for (const [title, ids] of GROUPS) {
    const items = visible.filter((p) => ids.includes(p.id as (typeof ids)[number]) && !physicsOut.has(p.id));
    items.forEach((p) => placed.add(p.id));
    if (items.length) grouped.set(title, items);
  }
  const phys = visible.filter((p) => physicsOut.has(p.id));
  phys.forEach((p) => placed.add(p.id));
  const other = visible.filter((p) => !placed.has(p.id));
  if (other.length) grouped.set("Custom", other);
  if (phys.length) grouped.set("Physics output", phys);

  type Row = { wrap: HTMLElement; range: HTMLInputElement; value: HTMLInputElement; def: number; min: number; max: number };
  const rows = new Map<string, Row>();
  const pending = new Map<string, number>();
  let raf = 0;

  const paint = (row: Row, v: number) => {
    row.range.value = String(v);
    row.range.style.setProperty("--p", `${((v - row.min) / (row.max - row.min || 1)) * 100}%`);
    if (document.activeElement !== row.value) row.value.value = fmt(v);
    row.wrap.classList.toggle("modified", Math.abs(v - row.def) > 1e-6 && !row.wrap.classList.contains("driven"));
  };

  if (!visible.length) {
    root.append(el("div", { class: "empty" }, q ? `"${filter}"에 맞는 파라미터가 없습니다` : "모델을 열면 파라미터가 여기에 나타납니다"));
  }

  for (const [title, items] of grouped) {
    const group = el("section", { class: collapsed.has(title) ? "group collapsed" : "group" });
    const head = el("button", { class: "group-head", type: "button", "aria-expanded": String(!collapsed.has(title)) });
    head.innerHTML = `${icon("chevronDown")}<span>${title}</span><span class="muted" style="margin-left:auto;letter-spacing:0">${items.length}</span>`;
    head.addEventListener("click", () => {
      const now = group.classList.toggle("collapsed");
      if (now) collapsed.add(title);
      else collapsed.delete(title);
      head.setAttribute("aria-expanded", String(!now));
    });
    const list = el("div", { class: "group-items" });

    for (const p of items) {
      const driven = drivenByMotion.has(p.id);
      const v0 = runtime.getParameter(p.id);
      const range = el("input", {
        class: "range",
        type: "range",
        min: String(p.min),
        max: String(p.max),
        step: String((p.max - p.min) / 400),
        "aria-label": p.name ?? p.id,
      });
      const value = el("input", { class: "param-value", type: "text", inputmode: "decimal", "aria-label": `${p.name ?? p.id} 값` });
      const chip = driven ? el("span", { class: "driven-chip", title: "모션 드라이버가 매 프레임 이 값을 씁니다" }, physicsOut.has(p.id) ? "물리" : "Idle") : null;
      const wrap = el(
        "div",
        { class: driven ? "param driven" : "param", title: `${p.id}  [${p.min}, ${p.max}] · 더블클릭으로 기본값` },
        el("div", { class: "param-row" }, el("span", { class: "param-name" }, p.name ?? p.id), chip, value),
        range,
      );
      const row: Row = { wrap, range, value, def: p.default, min: p.min, max: p.max };
      rows.set(p.id, row);
      paint(row, v0);

      range.addEventListener("input", () => {
        runtime.setParameter(p.id, Number(range.value));
      });
      range.addEventListener("dblclick", () => runtime.setParameter(p.id, p.default));
      value.addEventListener("keydown", (e) => {
        if (e.key === "Enter") value.blur();
        if (e.key === "Escape") {
          value.value = fmt(runtime.getParameter(p.id));
          value.blur();
        }
      });
      value.addEventListener("change", () => {
        const n = Number(value.value);
        if (Number.isFinite(n)) runtime.setParameter(p.id, n);
        value.value = fmt(runtime.getParameter(p.id));
      });
      list.append(wrap);
    }
    group.append(head, list);
    root.append(group);
  }

  return {
    update(id, v) {
      if (!rows.has(id)) return;
      pending.set(id, v);
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        for (const [pid, pv] of pending) {
          const row = rows.get(pid);
          if (row) paint(row, pv);
        }
        pending.clear();
      });
    },
  };
}
