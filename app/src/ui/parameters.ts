import type { IkiRuntime } from "../runtime/iki-runtime";
import { el } from "./dom";

/**
 * One slider per runtime parameter. Parameters written by the motion drivers
 * are marked, because dragging them while that driver runs gets overwritten on
 * the next frame.
 */
export function renderParameters(root: HTMLElement, runtime: IkiRuntime): (id: string, v: number) => void {
  root.replaceChildren();
  const driven = new Set(runtime.drivenParameterIds);
  const rows = new Map<string, { input: HTMLInputElement; readout: HTMLSpanElement }>();

  for (const p of runtime.getParameters()) {
    const value = runtime.getParameter(p.id);
    const readout = el("span", {}, value.toFixed(2));
    const input = el("input", {
      type: "range",
      min: String(p.min),
      max: String(p.max),
      step: String((p.max - p.min) / 200),
      value: String(value),
    });
    input.addEventListener("input", () => runtime.setParameter(p.id, Number(input.value)));
    const row = el(
      "div",
      { class: driven.has(p.id) ? "param driven" : "param", title: p.id },
      el("label", {}, el("span", {}, p.name ?? p.id), readout),
      input,
    );
    root.append(row);
    rows.set(p.id, { input, readout });
  }

  return (id, v) => {
    const row = rows.get(id);
    if (!row) return;
    row.input.value = String(v);
    row.readout.textContent = v.toFixed(2);
  };
}
