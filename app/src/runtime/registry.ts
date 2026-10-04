export type RuntimeId = "iki" | "ayagami";

export interface RuntimeDescriptor {
  id: RuntimeId;
  name: string;
  kind: "builtin" | "external";
  summary: string;
  formats: string;
  license: string;
}

export const RUNTIMES: readonly RuntimeDescriptor[] = [
  {
    id: "iki",
    name: "Iki",
    kind: "builtin",
    summary: "내장 런타임. 편집, 되돌리기, 물리 시뮬레이션, 캡처를 모두 지원합니다.",
    formats: ".iki",
    license: "MIT",
  },
  {
    id: "ayagami",
    name: "Ayagami",
    kind: "external",
    summary: "외부 어댑터 모듈로 연결하는 블랙박스 런타임. 파라미터 조작, 렌더, 캡처를 지원합니다.",
    formats: "어댑터가 정함 (예: .moc3, .zip)",
    license: "MIT / Apache-2.0",
  },
];

export interface AppSettings {
  runtime: RuntimeId;
  adapterUrls: Partial<Record<RuntimeId, string>>;
}

const KEY = "nyal2d.settings.v1";
const DEFAULTS: AppSettings = { runtime: "iki", adapterUrls: {} };

/** Per-browser preferences. Storage may be unavailable; fall back to defaults. */
export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULTS);
    const s = JSON.parse(raw) as Partial<AppSettings>;
    return {
      runtime: RUNTIMES.some((r) => r.id === s.runtime) ? (s.runtime as RuntimeId) : "iki",
      adapterUrls: typeof s.adapterUrls === "object" && s.adapterUrls ? s.adapterUrls : {},
    };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export function saveSettings(s: AppSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Private mode or blocked storage: settings last for this session only.
  }
}

export const EXAMPLE_ADAPTER_URL = "./adapters/example-adapter.js";
export const CONTRACT_DOC_URL = "https://github.com/fracktal/NyaL2D/blob/claude/ayagami-investigation-otx33a/docs/runtime/adapter-contract.md";
