import type { ModelSession } from "../model/model-session";
import { el } from "./dom";

export function renderChanges(root: HTMLElement, session: ModelSession): void {
  root.replaceChildren(
    ...(session.changes.length
      ? session.changes.map((c) =>
          el("li", {}, `${c.label} `, el("span", { class: "muted" }, `#${c.seq} · ${c.source}`)),
        )
      : [el("li", { class: "muted" }, "원본 그대로입니다. 변경은 여기에 순서대로 쌓입니다.")]),
  );
}
