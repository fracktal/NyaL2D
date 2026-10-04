# 에이전트 루프와 로컬 LLM 프록시

Phase 3의 2·3단계다. 도구 계층([first-capabilities.md](first-capabilities.md)) 위에서, 사람이 자연어로 요청하면 에이전트가 관찰 → 변경 → 확인을 반복한다.

## 구조

```
브라우저                                              로컬 프록시 (node)              제공자
┌──────────────────────────────────────────┐        ┌──────────────────────┐        ┌───────────┐
│ 에이전트 패널 (ui/agent-panel.ts)          │        │ server/llm-proxy.ts  │        │ Anthropic │
│   ↕ AgentEvent                            │  /llm  │  providers/          │  SDK   │ Messages  │
│ AgentSession (agent/loop.ts) ── 한 턴씩 ──┼───────→│   anthropic.ts ──────┼───────→│ API       │
│   ↕ callTool                              │ 중립   │   mock.ts            │        └───────────┘
│ 도구 계층 (agent/tools.ts)                 │ 포맷   │ API 키는 여기에만    │
│   ↕ EditCommand / setParameter            │        └──────────────────────┘
│ ModelSession · IkiRuntime                 │
└──────────────────────────────────────────┘
```

- **루프는 브라우저에 있다.** 도구가 런타임·편집 세션 옆에 있어야 하기 때문이다. 루프는 모델에 한 턴씩 묻고(`POST /llm/turn`), 돌아온 도구 호출을 도구 계층으로 실행해 결과를 다음 턴에 붙인다. 모델 파일을 직접 건드리는 경로는 없다.
- **프록시는 상태가 없다.** 대화 전체를 매번 받아 제공자 형식으로 바꿔 전달하고 응답을 중립 형식으로 돌려준다. 키는 프록시 프로세스의 환경에만 있다.
- **중립 프로토콜**(`app/src/agent/protocol.ts`): 텍스트, 도구 호출, 도구 결과(이미지 포함), 종료 사유(`end`, `tool_calls`, `pause`, `max_tokens`, `refusal`). 제공자 전용 정보는 assistant 턴의 `raw`에만 담겨 다음 요청에 그대로 되돌아간다. Anthropic의 thinking 블록처럼 바꾸지 않고 돌려보내야 하는 블록을 이 경로로 보존한다.
- **제공자 추가**: `server/providers/types.ts`의 `Provider`(`health`와 `turn` 또는 `run`)를 구현하고 `createProvider`에 등록한다. 브라우저 코드는 바뀌지 않는다.

## Claude Code로 실행하기 (API 키 없이)

`npm run proxy:claude`(`NYAL2D_LLM_PROVIDER=claude-code`)는 루프를 브라우저 대신 Claude Code에 맡긴다. 이 컴퓨터에 로그인된 Claude Code, 즉 사람의 Claude 구독으로 동작하므로 API 키가 필요 없다.

```
에이전트 패널 ── POST /llm/run (NDJSON 스트림) ──→ llm-proxy (claude-code 제공자)
                                                     │ spawn: claude -p … --tools "" --strict-mcp-config
                                                     ↓
                                                   Claude Code ── MCP (HTTP, /mcp) ──→ 도구 허브
                                                                                         │ WebSocket :8788/bridge
페이지의 도구 계층 (agent/tools.ts) ←──────────── BridgeClient (agent/bridge.ts) ←────────┘
```

- `/llm/health`가 `mode: "run"`을 알리면 패널(`AgentRouter`, `agent/router.ts`)이 실행 모드로 바뀌고 페이지가 도구 허브(`server/tool-hub.ts`)에 자동으로 연결된다.
- Claude Code에는 MCP 서버가 `nyal2d` 하나뿐이고 기본 도구(파일, 셸, 웹)는 꺼져 있다. 도구 호출은 페이지의 같은 도구 계층을 거치므로 검증, `AI` 변경 기록, Undo가 내장 루프와 똑같다.
- 패널에는 Claude Code의 텍스트가 스트림으로, 도구 호출이 허브를 지나며 단계(분석·변경·평가)로 표시된다. 다음 요청은 `--resume`으로 같은 대화를 이어 가고, `새 대화`는 새 세션을 시작한다.
- 환경 변수: `NYAL2D_CLAUDE_BIN`(CLI 경로, 기본 `claude`), `NYAL2D_LLM_MODEL`(`--model`), `NYAL2D_BRIDGE_PORT`(허브 포트, 기본 8788).
- **용도**: 개인·로컬 시험용이다. Claude Code 이용 약관이 적용되며, 다른 사람에게 배포하는 제품은 API 키 제공자를 쓴다.

### 내가 실행한 Claude Code / Claude Desktop에서 앱 조작하기

같은 도구 허브를 stdio MCP 서버로도 띄울 수 있다(`server/mcp-bridge.ts`).

```bash
claude mcp add nyal2d -- node /절대경로/NyaL2D/app/server/mcp-bridge.ts
```

Claude Desktop은 `claude_desktop_config.json`에 추가한다.

```json
{ "mcpServers": { "nyal2d": { "command": "node", "args": ["/절대경로/NyaL2D/app/server/mcp-bridge.ts"] } } }
```

그다음 앱의 에이전트 탭에서 플러그 버튼(Claude 앱 연결)을 켠다. 외부 클라이언트의 도구 호출도 패널에 "{클라이언트}에서 실행"으로 표시된다. 허브는 포트 8788 하나를 쓰므로 `proxy:claude`와 `mcp-bridge`는 동시에 하나만 띄운다. 탭을 여러 개 열면 마지막에 연결한 탭이 조작 대상이 된다. Node 22.18 이상이 필요하다(서버 코드를 TypeScript 그대로 실행).

## 단계 표시

스펙의 요청 → 분석 → 계획 → 변경 → 평가를 도구 호출 단위로 표시한다.

| 단계 | 기준 |
|---|---|
| 분석 | 이번 요청에서 아직 변경 도구를 쓰기 전의 관찰 도구 호출 |
| 계획 | 변경 도구 호출과 같은 턴에 나온 모델의 설명 |
| 변경 | `set_parameter`, `set_motion_mode`, `edit_physics_rig`, `edit_binding`, `undo`, `revert_all` |
| 평가 | 변경이 한 번이라도 성공한 뒤의 관찰 도구 호출과 설명 |

에이전트의 모델 편집은 `ModelSession.apply(cmd, "agent")`로 들어가 타임라인에 `AI`로 표시되고 Undo로 되돌린다. 모델이나 런타임이 바뀌면 대화는 새로 시작된다.

## 실패 처리

- 도구 오류(없는 리그, 잘못된 인자, 거부된 편집)는 예외가 아니라 `is_error` 도구 결과로 모델에 돌아가, 모델이 고쳐서 다시 시도할 수 있다.
- 한 요청은 최대 16턴. 넘으면 멈추고 알린다.
- 중단 버튼은 진행 중인 프록시 요청을 끊는다. 실행되지 못한 도구 호출에는 "사용자가 중단"을 결과로 채워 대화 기록을 유효하게 유지한다.
- 프록시가 꺼져 있거나 키가 없으면 패널 상단 상태와 오류 메시지가 무엇을 하면 되는지 알려 준다.

## Anthropic 제공자 설정

`server/providers/anthropic.ts`, 공식 `@anthropic-ai/sdk`(0.131.0 고정).

| 항목 | 값 | 이유 |
|---|---|---|
| 모델 | `claude-opus-5-5` (`NYAL2D_LLM_MODEL`로 변경) | 기본 권장 모델 |
| effort | `medium` (`NYAL2D_LLM_EFFORT`) | 대화형 작업의 응답 속도. 어려운 리깅 작업은 `high` 권장 |
| thinking | 생략 (적응형) | 이 모델에서는 끌 수 없음. thinking 블록은 `raw`로 왕복 |
| 캐싱 | 최상위 `cache_control` | 매 턴 늘어나는 대화 접두부 재사용 |
| 거절 대비 | `fallbacks: "default"` + `server-side-fallback-2026-07-01` | 안전 분류기가 거절하면 서버가 권장 모델로 재시도. 그래도 거절이면 패널에 표시 |
| 강제 도구 호출 | 쓰지 않음 (`auto`) | 이 모델에서 `any`/`tool`은 400 |

자격 증명은 `ANTHROPIC_API_KEY` 또는 `ant auth login` 프로필에서 SDK가 찾는다. `/llm/health`는 `models.retrieve`로 실제 접근 가능 여부를 확인한다(60초 캐시).

## 보안

- 프록시는 `127.0.0.1`에만 바인딩하고, `Origin`이 localhost/127.0.0.1이 아닌 요청은 403으로 거절한다. 다른 웹사이트가 사용자의 키로 요청을 보내지 못하게 하기 위해서다.
- 요청 본문 상한 25MB(캡처 이미지 포함).
- 도구 허브의 WebSocket도 `127.0.0.1`에만 바인딩하고 localhost가 아닌 `Origin`의 페이지는 1008로 끊는다. Claude Code 실행 시에는 이 세션 밖의 Claude Code 환경 변수를 넘기지 않고, 별도 작업 폴더(`$TMPDIR/nyal2d-agent`)에서 실행한다.

## 검증 상태

- **Observed (단위 테스트, `app/test/agent-loop.test.ts`)**: 모의 제공자로 요청 → 변경 → 보고 한 바퀴, 모든 도구 호출에 결과가 정확히 하나씩 짝지어짐, 도구 오류 전달, 캡처 이미지 전달, 프록시 오류·거절·단계 한도, Anthropic 형식 변환(thinking 블록 왕복 포함), Origin 검사.
- **Observed (브라우저 스모크, `app/scripts/smoke.mjs`)**: 실제 페이지에서 모의 프록시로 제안 칩을 눌러 5단계가 실행되고, 변경 2건이 타임라인에 `AI`로 표시됨. 스크린샷 `smoke-out/04b-agent-dark.png`.
- **Observed (단위 테스트, `app/test/tool-hub.test.ts`, `app/test/claude-code.test.ts`)**: 허브가 페이지 도구를 MCP로 내보내고 호출을 중계, 페이지 미연결 시 즉시 오류, 외부 Origin 거절, 새 탭 우선. 가짜 CLI로 stream-json 파싱(줄 분할, 실패 결과, 비정상 종료와 stderr, 중단).
- **Observed (실제 Claude Code, `app/scripts/agent-e2e.mjs`)**: 로그인된 Claude Code CLI로 "숨 쉬는 동작을 지금보다 절반 정도로 은은하게 해 줘"를 패널에 입력. 기능 확인 → 모델 구조 살펴보기 → 바인딩 수정 2회로 `ParamBreath`의 몸 translateY 4.6→2.3, 머리 2.95→1.475가 되었고 타임라인에 `AI` 변경 2건, 콘솔 오류 없음. 스크린샷 `smoke-out/agent-claude-code.png`.
- **미검증**: 실제 Anthropic 모델과의 API 키 왕복. 이 개발 환경에는 API 키가 없다. 키가 없을 때의 상태 표시(`not ready`)는 확인했다.
