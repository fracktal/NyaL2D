/**
 * Wire format between the browser agent loop and the local LLM proxy
 * (app/server/llm-proxy.ts).
 *
 * It is deliberately provider-neutral: the browser never sees a provider's
 * request shape, and each proxy provider maps this format onto its own API.
 * The one provider-specific thing that crosses the wire is `raw` on assistant
 * turns: the provider's own content blocks, echoed back untouched on the next
 * request so details the neutral format drops (thinking blocks, for one)
 * survive the round trip. The browser treats it as opaque.
 */
import type { ToolSpec } from "./tools";

export type AssistantBlock = { type: "text"; text: string } | { type: "tool_call"; id: string; name: string; input: unknown };

export type UserBlock =
  | { type: "text"; text: string }
  | {
      type: "tool_result";
      callId: string;
      ok: boolean;
      /** JSON text of the tool's data, or the error message. */
      content: string;
      image?: { mediaType: string; base64: string };
    };

export type LlmMessage = { role: "user"; content: UserBlock[] } | { role: "assistant"; content: AssistantBlock[]; raw?: unknown };

export interface TurnRequest {
  system: string;
  messages: LlmMessage[];
  tools: ToolSpec[];
}

export type StopReason =
  /** The model finished its answer. */
  | "end"
  /** The model wants the tool calls in `content` run. */
  | "tool_calls"
  /** The provider paused a long turn; send the history back to continue. */
  | "pause"
  | "max_tokens"
  /** The provider's safety system declined the request. */
  | "refusal";

export interface TurnResponse {
  content: AssistantBlock[];
  stop: StopReason;
  raw?: unknown;
  /** The model that actually answered (it can differ after a fallback). */
  model?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

export interface ProxyHealth {
  provider: string;
  model: string;
  ready: boolean;
  /** Why the provider is not ready, in words a person can act on. */
  detail?: string;
}

export interface ProxyError {
  error: string;
  /** Whether trying again later may succeed (rate limit, overload, network). */
  retryable?: boolean;
}
