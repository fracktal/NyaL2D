import { listLibrary, removeFromLibrary, type LibraryEntry } from "../model/library";
import { el } from "./dom";
import { icon } from "./icons";

export type LibraryChoice = { kind: "sample" } | { kind: "entry"; file: string } | { kind: "import"; files: File[] };

const KIND_LABEL: Record<LibraryEntry["kind"], string> = { model: ".iki", psd: "PSD", image: "이미지" };

function size(bytes: number): string {
  return bytes >= 1 << 20 ? `${(bytes / (1 << 20)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * The model picker: the built-in sample, every file in the character library,
 * and an import button. Resolves with what to open, or undefined when closed.
 */
export function openLibrary(current: string | undefined): Promise<LibraryChoice | undefined> {
  const dialog = el("dialog", { class: "modal", "aria-labelledby": "library-title" });
  const list = el("div", { class: "lib-list", role: "list" });
  const close = el("button", { class: "btn ghost icon", type: "button", "aria-label": "닫기" });
  close.innerHTML = icon("close");
  const input = el("input", { type: "file", multiple: true, accept: ".iki,.json,.psd,.png,.webp", class: "sr-only" });
  const importBtn = el("label", { class: "btn primary", tabindex: "0" }, "파일 가져오기", input);
  let result: LibraryChoice | undefined;
  const choose = (c: LibraryChoice) => {
    result = c;
    dialog.close();
  };

  const row = (title: string, meta: string, active: boolean, onOpen: () => void, onRemove?: () => void) => {
    const open = el("button", { class: "btn sm", type: "button" }, active ? "다시 열기" : "열기");
    open.addEventListener("click", onOpen);
    const r = el("div", { class: active ? "lib-row active" : "lib-row", role: "listitem" }, el("div", { class: "lib-name" }, el("b", {}, title), el("span", { class: "muted" }, meta)), el("span", { class: "spacer" }), open);
    if (onRemove) {
      const del = el("button", { class: "btn ghost sm", type: "button", title: "라이브러리에서 지우기" }, "삭제");
      del.addEventListener("click", onRemove);
      r.append(del);
    }
    r.addEventListener("dblclick", onOpen);
    return r;
  };

  const render = async () => {
    list.replaceChildren(row("hero", "내장 샘플 · .iki", current === "hero.iki", () => choose({ kind: "sample" })));
    let entries: LibraryEntry[] = [];
    try {
      entries = await listLibrary();
    } catch (err) {
      list.append(el("p", { class: "rt-status error" }, `라이브러리를 읽지 못했습니다: ${(err as Error).message}`));
      return;
    }
    for (const e of entries) {
      list.append(
        row(e.file.replace(/\.[^.]+$/, ""), `${KIND_LABEL[e.kind]} · ${size(e.size)} · ${new Date(e.modified).toLocaleString()}`, current === e.file, () => choose({ kind: "entry", file: e.file }), async () => {
          if (!confirm(`${e.file}을(를) 라이브러리에서 지울까요? (WSL의 app/public/local에서 파일이 삭제됩니다)`)) return;
          try {
            await removeFromLibrary(e.file);
          } catch (err) {
            alert((err as Error).message);
          }
          void render();
        }),
      );
    }
    if (!entries.length) list.append(el("p", { class: "modal-hint" }, "아직 가져온 캐릭터가 없습니다. PSD나 .iki를 가져오면 여기에 쌓입니다."));
  };

  input.addEventListener("change", () => {
    const files = [...(input.files ?? [])];
    if (files.length) choose({ kind: "import", files });
  });

  const form = el(
    "form",
    { method: "dialog" },
    el("header", { class: "modal-head" }, el("h2", { id: "library-title" }, "모델"), el("span", { class: "spacer" }), close),
    el(
      "div",
      { class: "modal-body" },
      el("p", { class: "modal-hint" }, "열 캐릭터를 고르세요. 가져온 PSD·.iki는 이 PC(WSL app/public/local)에 저장되고 git에는 올라가지 않습니다. PSD는 열 때마다 자동 리깅합니다."),
      list,
    ),
    el("footer", { class: "modal-foot" }, el("span", { class: "muted", style: "font-size:12px" }, "PSD · .iki · 레이어 PNG 여러 장"), el("span", { class: "spacer" }), importBtn),
  );
  dialog.append(form);
  document.body.append(dialog);
  void render();

  return new Promise((resolve) => {
    close.addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", () => {
      dialog.remove();
      resolve(result);
    });
    dialog.showModal();
  });
}
