import type { ProxyError, ProxyHealth, TurnRequest, TurnResponse } from "./protocol";

/** How the agent loop reaches a model. The UI and loop depend only on this. */
export interface LlmClient {
  health(): Promise<ProxyHealth>;
  turn(req: TurnRequest, signal?: AbortSignal): Promise<TurnResponse>;
}

export class LlmError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable = false) {
    super(message);
    this.retryable = retryable;
  }
}

/** Talks to the app server (app/server/app-server.ts) at `/llm`, mounted on the same dev/preview server as the page. */
export class ProxyLlmClient implements LlmClient {
  readonly baseUrl: string;

  constructor(baseUrl = "./llm") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async health(): Promise<ProxyHealth> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/health`, { cache: "no-store" });
    } catch {
      throw new LlmError("앱 서버에 연결하지 못했습니다. app 폴더에서 `npm run dev`로 실행한 주소로 열었는지 확인하세요.", true);
    }
    if (!res.ok) throw await toError(res);
    return (await res.json()) as ProxyHealth;
  }

  async turn(req: TurnRequest, signal?: AbortSignal): Promise<TurnResponse> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/turn`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(req),
        signal,
      });
    } catch (err) {
      if ((err as Error).name === "AbortError") throw err;
      throw new LlmError("앱 서버에 연결하지 못했습니다. app 폴더에서 `npm run dev`로 실행한 주소로 열었는지 확인하세요.", true);
    }
    if (!res.ok) throw await toError(res);
    return (await res.json()) as TurnResponse;
  }
}

async function toError(res: Response): Promise<LlmError> {
  try {
    const body = (await res.json()) as ProxyError;
    if (body?.error) return new LlmError(body.error, !!body.retryable);
  } catch {
    // Not JSON: something other than the NyaL2D app server answered (e.g. a static file server).
  }
  if (res.status === 404 || res.status === 502 || res.status === 504) {
    return new LlmError("에이전트 서버가 없습니다. 정적 파일 서버 대신 `npm run dev`(또는 `npm run preview`)로 실행하세요.", true);
  }
  return new LlmError(`앱 서버 오류 (HTTP ${res.status})`, res.status >= 500);
}
