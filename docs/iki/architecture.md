# Iki 아키텍처

## 패키지 계층

**Confirmed** (루트 `README.md`, `AGENTS.md`의 Core Rules, 각 `package.json`)

```text
@ikijs/format   ── .iki 스키마(타입) · 검증기 · 로더          (의존성 없음)
     ↑
     ├── @ikijs/engine  ── WebGL2 플레이어 · 모션 드라이버     (format에만 의존)
     ├── @ikijs/editor  ── 헤드리스 편집 코어: 문서, 명령, undo/redo,
     │                     아틀라스, 오토리거                   (format에만 의존, DOM 없음)
     └── @ikijs/mcp     ── stdio MCP 서버 (Node, sharp로 이미지 디코드)
                                                               (editor + format)
examples/playground, examples/editor (React)  ← 위 패키지의 소비자
```

- 엔진은 호스트에 독립적이다. "`@ikijs/engine` depends only on `@ikijs/format`. It must never import a host framework."
- `@ikijs/format`이 `.iki` 계약의 단일 진실 공급원이다. 엔진은 포맷 타입을 읽기만 하고 재정의하지 않는다.
- 외부 입력은 `@ikijs/format`에서 검증하고, 실패 시 경로가 붙은 메시지의 `IkiFormatError`를 던진다.

## 모델 구조

**Confirmed** (`packages/format/src/types.ts`)

```text
IkiModel
├── version, name, canvas {width, height}
├── parameters[]      id, name?, min, max, default
├── textures[]        source (v1은 data:image/ URI만)
├── parts[]           뒤→앞 합성되는 평면 목록
│   ├── color, width, height, transform, order
│   ├── bindings[]    파라미터 → 변환 채널 선형 매핑
│   ├── texture?      {index, uv}
│   ├── mesh?         vertices, uvs, indices (파트 로컬 ±0.5)
│   ├── warps[]       파라미터별 정점 키폼
│   ├── deformer?     매달린 디포머 id
│   └── clip?         마스크 파트 id 목록 (스텐실)
├── deformers[]
│   ├── matrix        pivot, transform, bindings, parent
│   └── warp          grid(제어점 격자), warps(1D) 또는 warp2d(2D), parent는 matrix만
├── physics[]         1D 스프링-질량-감쇠: input → output 파라미터
└── physicsChains[]   다관절 각진자 체인 (중력, matrix 디포머에 고정)
```

모든 것이 평범한 JSON이다. 바이너리나 컴파일 단계가 없다.

## 런타임 구조

**Confirmed** (`packages/engine/src/player.ts`, `iki-motion.ts`, 엔진 README)

```text
            호스트(앱)
   ┌──────────────┴───────────────┐
   │ setParameter / getParameter  │ update(nowMs)
   ▼                              ▼
IkiPlayer                     모션 드라이버 (렌더 루프와 분리된 순수 로직)
├── ParameterStore (클램프)     ├── IdleMotion      깜빡임·호흡·시선·머리 흔들림
├── load(): 텍스처 디코드·업로드 ├── PhysicsMotion   model.physics
│   후 원자적 교체               └── HairChainMotion model.physicsChains
└── rAF 루프 → renderFrame()        (IkiMotion = 셋을 순서대로 묶은 것)
        │
        ▼
   CPU: 디포머 월드 행렬 → 워프 격자 → 정점 변형
   GPU: WebGL2, 프리멀티플라이드 알파, 스텐실 클리핑
        │
        ▼
   <canvas>
```

- 드라이버는 "peer drivers, not part of the render loop"이며 `read`/`sink` 콜백으로만 파라미터를 읽고 쓴다.
- 물리 드라이버는 1/60초 고정 서브스텝으로 적분하고 프레임 델타를 100ms로 클램프한다 (`frame-clock.ts`의 `FIXED_DT_S`, `MAX_DT_MS`).

**Observed**
- 드라이버는 DOM 없이 Node에서 합성 타임스탬프로 결정적으로 돈다 (`app/test/simulate.test.ts`, `app/src/runtime/simulate.ts`).

**Inference**
- 렌더링과 시뮬레이션이 분리돼 있으므로, 에이전트의 "설정 → 시뮬레이션 → 평가" 루프는 수치 평가는 헤드리스로 빠르게, 시각 평가는 브라우저 캡처로 나눠 돌릴 수 있다.

## 편집 구조

**Confirmed** (`packages/editor/README.md`, `document.ts`, `commands.ts`)

```text
EditorDocument(model)   ← 생성 시 structuredClone
  execute(cmd) / undo() / redo()
  toIkiModel()          ← parseIkiModel로 검증 후 반환, 실패 시 IkiFormatError
EditCommand { apply(doc), invert(doc), label }
  - 첫 apply에서 이전 값을 캡처 → undo가 항상 원래 값 복원
  - 모델을 무효로 만들 수 있는 명령은 변경 전에 후보를 검증 → 거부된 편집은 문서를 건드리지 않음
```

**Observed**: 잘못된 물리 값(`mass: -1`)은 예외를 던지고 모델과 변경 목록이 그대로 남는다 (`app/test/model.test.ts`).

**Inference**: 스펙 9절의 "원본 + Change 001 + Change 002 …, 검사·되돌리기·재적용" 요구는 `EditCommand`가 거의 그대로 제공한다. 앱은 변경 목록과 출처만 덧붙이면 된다 (`app/src/model/model-session.ts`).
