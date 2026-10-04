import { iconEl } from "./icons";

export function toast(message: string, kind: "ok" | "error" = "ok"): void {
  let host = document.querySelector<HTMLElement>(".toasts");
  if (!host) {
    host = document.createElement("div");
    host.className = "toasts";
    host.setAttribute("role", "status");
    host.setAttribute("aria-live", "polite");
    document.body.append(host);
  }
  const t = document.createElement("div");
  t.className = `toast ${kind}`;
  t.append(iconEl(kind === "ok" ? "check" : "alert"), document.createTextNode(message));
  host.append(t);
  setTimeout(() => {
    t.classList.add("leaving");
    setTimeout(() => t.remove(), 220);
  }, kind === "error" ? 6000 : 2600);
}
