import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaContentBlockParam,
  BetaMessage,
  BetaMessageParam,
  BetaTool,
  BetaToolResultBlockParam,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { AssistantBlock, LlmMessage, StopReason, TurnResponse } from "../../src/agent/protocol.ts";
import type { ToolSpec } from "../../src/agent/tools.ts";
import { ProviderError, type Provider } from "./types.ts";

export const DEFAULT_MODEL = "claude-opus-5-5";
type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export function toAnthropicTools(tools: ToolSpec[]): BetaTool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as BetaTool["input_schema"],
  }));
}

export function toAnthropicMessages(messages: LlmMessage[]): BetaMessageParam[] {
  return messages.map((m): BetaMessageParam => {
    if (m.role === "assistant") {
      // Echo the provider's own blocks when we have them: they carry thinking
      // blocks that must come back unchanged on the next request.
      if (Array.isArray(m.raw)) return { role: "assistant", content: m.raw as BetaContentBlockParam[] };
      return {
        role: "assistant",
        content: m.content.map((b): BetaContentBlockParam =>
          b.type === "text" ? { type: "text", text: b.text } : { type: "tool_use", id: b.id, name: b.name, input: b.input },
        ),
      };
    }
    return {
      role: "user",
      content: m.content.map((b): BetaContentBlockParam => {
        if (b.type === "text") return { type: "text", text: b.text };
        const content: BetaToolResultBlockParam["content"] = [{ type: "text", text: b.content }];
        if (b.image) {
          content.push({
            type: "image",
            source: { type: "base64", media_type: b.image.mediaType as "image/png", data: b.image.base64 },
          });
        }
        return { type: "tool_result", tool_use_id: b.callId, content, is_error: !b.ok };
      }),
    };
  });
}

const STOP: Record<string, StopReason> = {
  end_turn: "end",
  stop_sequence: "end",
  tool_use: "tool_calls",
  pause_turn: "pause",
  max_tokens: "max_tokens",
  model_context_window_exceeded: "max_tokens",
  refusal: "refusal",
};

export function fromAnthropic(msg: BetaMessage): TurnResponse {
  const content: AssistantBlock[] = [];
  for (const b of msg.content) {
    if (b.type === "text") content.push({ type: "text", text: b.text });
    else if (b.type === "tool_use") content.push({ type: "tool_call", id: b.id, name: b.name, input: b.input });
  }
  return {
    content,
    stop: STOP[msg.stop_reason ?? "end_turn"] ?? "end",
    raw: msg.content,
    model: msg.model,
    usage: { inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens },
  };
}

export function createAnthropicProvider(opts: { model?: string; effort?: Effort } = {}): Provider {
  const model = opts.model ?? DEFAULT_MODEL;
  const effort = opts.effort ?? "medium";
  // Credentials come from the environment (ANTHROPIC_API_KEY, or an
  // `ant auth login` profile); they never leave this process.
  let client: Anthropic | undefined;
  const getClient = () => (client ??= new Anthropic());
  let healthCache: { at: number; ready: boolean; detail?: string } | undefined;

  return {
    async health() {
      if (!healthCache || Date.now() - healthCache.at > 60_000) {
        try {
          await getClient().models.retrieve(model);
          healthCache = { at: Date.now(), ready: true };
        } catch (err) {
          healthCache = { at: Date.now(), ready: false, detail: describe(err).message };
        }
      }
      return { provider: "anthropic", model, ready: healthCache.ready, detail: healthCache.detail };
    },

    async turn(req, signal) {
      try {
        const msg = await getClient().beta.messages.create(
          {
            model,
            max_tokens: 16000,
            system: req.system,
            tools: toAnthropicTools(req.tools),
            messages: toAnthropicMessages(req.messages),
            output_config: { effort },
            // Cache the growing conversation prefix across agent turns.
            cache_control: { type: "ephemeral" },
            // A safety decline is retried server-side on the recommended model.
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
          },
          { signal },
        );
        return fromAnthropic(msg);
      } catch (err) {
        throw describe(err);
      }
    },
  };
}

function describe(err: unknown): ProviderError {
  const noCredentials = err instanceof Anthropic.AnthropicError && /authentication method/i.test(err.message);
  if (err instanceof Anthropic.AuthenticationError || noCredentials) {
    return new ProviderError("Anthropic 인증에 실패했습니다. 프록시를 실행한 셸에 ANTHROPIC_API_KEY를 설정하거나 `ant auth login`을 실행하세요.", 401);
  }
  if (err instanceof Anthropic.PermissionDeniedError) return new ProviderError(`권한이 없습니다: ${err.message}`, 403);
  if (err instanceof Anthropic.NotFoundError) return new ProviderError(`모델을 찾을 수 없습니다: ${err.message}`, 404);
  if (err instanceof Anthropic.RateLimitError) return new ProviderError("요청 한도에 걸렸습니다. 잠시 후 다시 시도하세요.", 429, true);
  if (err instanceof Anthropic.BadRequestError) return new ProviderError(`요청이 거부되었습니다: ${err.message}`, 400);
  if (err instanceof Anthropic.APIConnectionError) return new ProviderError("Anthropic API에 연결하지 못했습니다. 네트워크를 확인하세요.", 502, true);
  if (err instanceof Anthropic.APIError) {
    const status = err.status ?? 502;
    return new ProviderError(`Anthropic API 오류 (${status}): ${err.message}`, 502, status >= 500);
  }
  if (err instanceof Anthropic.AnthropicError) return new ProviderError(err.message, 500);
  return new ProviderError((err as Error).message ?? String(err), 500);
}
