import type { ModelSession } from "../model/model-session";
import { el } from "./dom";

/** Horizontal change timeline: Original → #1 → #2 …, undone changes faded. */
export function renderChanges(root: HTMLElement, session: ModelSession): void {
  const nodes: HTMLElement[] = [el("span", { class: "node origin", title: "원본 모델은 변경되지 않습니다" }, "원본")];
  const applied = session.changes;
  applied.forEach((c, i) => {
    nodes.push(el("span", { class: "link" }));
    nodes.push(
      el(
        "span",
        { class: i === applied.length - 1 ? "node latest" : "node", title: `${c.label} · ${c.source}` },
        el("span", { class: "seq" }, `#${c.seq}`),
        c.label,
        el("span", { class: "src" }, c.source),
      ),
    );
  });
  for (const c of [...session.redoable].reverse()) {
    nodes.push(el("span", { class: "link" }));
    nodes.push(el("span", { class: "node redo", title: "Redo로 다시 적용" }, el("span", { class: "seq" }, `#${c.seq}`), c.label));
  }
  if (!applied.length && !session.redoable.length) {
    nodes.push(el("span", { class: "muted", style: "font-size:12px;margin-left:6px" }, "변경은 원본을 건드리지 않고 여기에 순서대로 쌓입니다"));
  }
  root.replaceChildren(...nodes);
  root.scrollLeft = root.scrollWidth;
}
