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

/** Talks to the local proxy (app/server/llm-proxy.ts), by default through the dev server's `/llm` route. */
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
      throw new LlmError("로컬 프록시에 연결하지 못했습니다. `npm run proxy`로 실행하세요.", true);
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
      throw new LlmError("로컬 프록시에 연결하지 못했습니다. `npm run proxy`로 실행하세요.", true);
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
    // Not JSON: the dev server answered because the proxy is not running.
  }
  if (res.status === 404 || res.status === 502 || res.status === 504) {
    return new LlmError("로컬 프록시가 응답하지 않습니다. `npm run proxy`로 실행하세요.", true);
  }
  return new LlmError(`프록시 오류 (HTTP ${res.status})`, res.status >= 500);
}
