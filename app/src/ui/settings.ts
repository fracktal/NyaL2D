import { importAdapter } from "../runtime/external-runtime";
import { adapterUrlFor, CONTRACT_DOC_URL, EXAMPLE_ADAPTER_URL, RUNTIMES, type AppSettings, type RuntimeId } from "../runtime/registry";
import { el } from "./dom";
import { icon } from "./icons";

/**
 * Settings dialog. Resolves with the new settings when the user applies,
 * or `undefined` when they cancel.
 */
export function openSettings(current: AppSettings): Promise<AppSettings | undefined> {
  const draft: AppSettings = structuredClone(current);
  const dialog = el("dialog", { class: "modal", "aria-labelledby": "settings-title" });

  const status = new Map<RuntimeId, HTMLElement>();
  const cards = RUNTIMES.map((r) => {
    const radio = el("input", { type: "radio", name: "runtime", value: r.id, checked: draft.runtime === r.id });
    const card = el("label", { class: draft.runtime === r.id ? "rt-card selected" : "rt-card" });
    radio.addEventListener("change", () => {
      draft.runtime = r.id;
      for (const c of dialog.querySelectorAll(".rt-card")) c.classList.toggle("selected", c === card);
      validate();
    });
    const head = el(
      "div",
      { class: "rt-head" },
      radio,
      el("b", {}, r.name),
      el("span", { class: r.kind === "builtin" ? "badge ok" : "badge" }, r.kind === "builtin" ? "내장" : "외부 어댑터"),
      el("span", { class: "spacer" }),
      el("span", { class: "muted mono" }, r.license),
    );
    card.append(head, el("p", { class: "rt-summary" }, r.summary), el("div", { class: "rt-meta" }, `모델 형식 · ${r.formats}`));

    if (r.kind === "external") {
      const url = el("input", {
        class: "text-input mono",
        // Not type="url": relative module paths are valid here.
        type: "text",
        placeholder: r.defaultAdapterUrl ? `${r.defaultAdapterUrl} (기본 래퍼)` : "https://…/adapter.js",
        value: draft.adapterUrls[r.id] ?? "",
        "aria-label": `${r.name} 어댑터 모듈 URL`,
        spellcheck: "false",
      });
      const idleHint = r.defaultAdapterUrl
        ? "비워 두면 기본 래퍼를 씁니다. 다른 어댑터가 있으면 URL을 넣으세요."
        : "어댑터 모듈 URL을 넣고 연결을 확인하세요.";
      const line = el("div", { class: "rt-status muted" }, idleHint);
      status.set(r.id, line);
      url.addEventListener("input", () => {
        draft.adapterUrls[r.id] = url.value.trim();
        line.className = "rt-status muted";
        line.textContent = url.value.trim() ? "연결을 확인하세요." : idleHint;
        validate();
      });
      const test = el("button", { class: "btn sm", type: "button" }, "연결 확인");
      test.addEventListener("click", async (e) => {
        e.preventDefault();
        line.className = "rt-status muted";
        line.textContent = "확인 중…";
        try {
          const mod = await importAdapter(adapterUrlFor(draft, r.id) ?? "");
          const connected = mod.meta.connected !== false;
          line.className = connected ? "rt-status ok" : "rt-status warn";
          line.innerHTML = `${icon(connected ? "check" : "plug")}<span></span>`;
          line.querySelector("span")!.textContent = `${mod.meta.name}${mod.meta.version ? ` v${mod.meta.version}` : ""} · 규약 v1 확인됨${connected ? "" : " · 빈 래퍼라 아직 모델을 열 수 없습니다"}`;
        } catch (err) {
          line.className = "rt-status error";
          line.innerHTML = `${icon("alert")}<span></span>`;
          line.querySelector("span")!.textContent = (err as Error).message;
        }
      });
      const example = el("button", { class: "btn ghost sm", type: "button" }, "예제 어댑터로 시험");
      example.addEventListener("click", (e) => {
        e.preventDefault();
        url.value = EXAMPLE_ADAPTER_URL;
        url.dispatchEvent(new Event("input"));
        test.click();
      });
      const note = el("p", { class: "rt-note" });
      note.innerHTML = r.defaultAdapterUrl
        ? `기본 래퍼는 <a href="${CONTRACT_DOC_URL}" target="_blank" rel="noopener">어댑터 규약</a>의 모양만 갖춘 빈 모듈입니다. 사람이 ${r.name}를 연결해 채우거나 규약을 따르는 다른 모듈 URL을 넣으면, 앱은 규약 함수만 호출하는 블랙박스로 사용합니다.`
        : `${r.name} 어댑터는 앱에 포함되어 있지 않습니다. <a href="${CONTRACT_DOC_URL}" target="_blank" rel="noopener">어댑터 규약</a>을 따르는 ES 모듈을 만들어 그 URL을 지정하면, 앱은 규약 함수만 호출하는 블랙박스로 사용합니다.`;
      card.append(el("div", { class: "rt-url" }, url, test), el("div", { class: "rt-actions" }, example), line, note);
    }
    return card;
  });

  const apply = el("button", { class: "btn primary", type: "submit" }, "적용");
  const cancel = el("button", { class: "btn ghost", type: "button" }, "취소");
  const close = el("button", { class: "btn ghost icon", type: "button", "aria-label": "닫기" });
  close.innerHTML = icon("close");

  const validate = () => {
    const r = RUNTIMES.find((x) => x.id === draft.runtime)!;
    apply.disabled = r.kind === "external" && !adapterUrlFor(draft, r.id);
  };
  validate();

  const form = el(
    "form",
    { method: "dialog" },
    el("header", { class: "modal-head" }, el("h2", { id: "settings-title" }, "설정"), el("span", { class: "spacer" }), close),
    el(
      "div",
      { class: "modal-body" },
      el("div", { class: "section-title" }, "런타임"),
      el("p", { class: "modal-hint" }, "모델을 읽고 렌더링할 엔진을 고릅니다. 바꾸면 현재 모델은 닫힙니다."),
      el("div", { class: "rt-list", role: "radiogroup", "aria-label": "런타임" }, ...cards),
    ),
    el("footer", { class: "modal-foot" }, el("span", { class: "spacer" }), cancel, apply),
  );
  dialog.append(form);
  document.body.append(dialog);

  return new Promise((resolve) => {
    let result: AppSettings | undefined;
    form.addEventListener("submit", () => {
      result = draft;
    });
    cancel.addEventListener("click", () => dialog.close());
    close.addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", () => {
      dialog.remove();
      resolve(result);
    });
    dialog.showModal();
  });
}
