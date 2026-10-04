# 통합 경계: Web App ↔ Iki ↔ 모델

이 문서는 스펙 21절 Task 4의 결과다. 무엇이 누구의 책임이고, 경계를 넘는 데이터가 정확히 무엇인지 정리한다.

## 한눈에 보기

```text
┌──────────────────────────── Web Application (app/) ────────────────────────────┐
│  UI (ui/*)          슬라이더 · 인스펙터 · 변경 목록 · 캡처 · 내보내기          │
│  ModelSession       원본(동결) + 변경 스택 + 출처        ── @ikijs/editor 사용 │
│  inspectModel       모델 → JSON 스냅샷                    ── @ikijs/format 타입 │
│  simulatePhysics    헤드리스 물리                         ── @ikijs/engine 드라이버│
│  IkiRuntime         유일한 플레이어 경계                  ── @ikijs/engine      │
└───────────────┬───────────────────────────────────────▲───────────────────────┘
                │ IkiModel (검증된 JSON 객체)            │ 파라미터 값, 로드 결과,
                │ setParameter(id, value)               │ 캔버스 픽셀(캡처)
                │ update(nowMs)  (모션 드라이버)         │
┌───────────────▼───────────────────────────────────────┴───────────────────────┐
│                                Iki (npm 패키지)                               │
│  @ikijs/format   스키마 · parseIkiModel · StandardParameter                   │
│  @ikijs/engine   IkiPlayer(WebGL2) · ParameterStore · Idle/Physics/Chain      │
│  @ikijs/editor   EditorDocument · EditCommand · 검증된 편집                   │
└───────────────┬───────────────────────────────────────▲───────────────────────┘
                │ loadIkiModel(text)                    │ serialize() → .iki 텍스트
┌───────────────▼───────────────────────────────────────┴───────────────────────┐
│                         Model: .iki (JSON, 텍스처 data: URI 내장)              │
└───────────────────────────────────────────────────────────────────────────────┘
```

## 경계별 계약

### 모델 ↔ Iki

| 방향 | 호출 | 계약 | 근거 |
|---|---|---|---|
| 파일 → 메모리 | `loadIkiModel(text)` | 검증 실패 시 경로가 붙은 `IkiFormatError` | Confirmed |
| 메모리 → 파일 | `EditorDocument.serialize()` | 항상 검증 후 직렬화. 무효 모델은 파일로 나가지 않음 | Confirmed |
| 왕복 | load → 편집 → serialize → load | 편집 내용이 보존됨 | Observed (`app/test/model.test.ts`) |

### Iki ↔ Web App

| 기능 | 앱이 쓰는 Iki API | 앱이 보태는 것 | 근거 |
|---|---|---|---|
| 로드 | `IkiPlayer.load` | 복제본 전달, 재로드 시 파라미터 값 복원, `superseded` 처리 | Confirmed + Observed |
| 파라미터 읽기·쓰기 | `get/setParameter`, `getParameters` | 변경 알림(`onParameter`) | Confirmed |
| 모션 | `IkiMotion`, `PhysicsMotion`, `HairChainMotion` | 모드 전환(idle / physics / off), 모델 변경 시 재생성 | Confirmed + Observed |
| 헤드리스 시뮬레이션 | `ParameterStore` + 물리 드라이버 | 합성 타임스탬프 루프, 기록 | Observed |
| 편집 | `EditorDocument`, `EditCommand` | 변경 목록·출처·원본 되돌리기 | Confirmed + Observed |
| 관찰(인스펙터) | 모델 타입 | 참조 관계(usedBy / drivenBy) 계산, 큰 배열 요약 | 앱 구현 |
| 프레임 캡처 | 없음 | rAF 안에서 `canvas.toDataURL` | Observed |

### 런타임 선택

앱은 `PuppetRuntime` 인터페이스(`app/src/runtime/types.ts`)로 런타임을 다룬다. Iki는 이를 구현하면서 편집·물리 시뮬레이션·전체 인스펙션 기능을 추가로 제공한다. 외부 런타임(설정의 Ayagami 슬롯 등)은 [어댑터 규약](../runtime/adapter-contract.md)의 ES 모듈을 블랙박스로 불러오며, 파라미터·렌더·캡처만 쓸 수 있다. 각 런타임은 `capabilities`로 무엇이 되는지 밝히고, UI는 그에 따라 기능을 끈다.

### Web App 내부 규칙

- `@ikijs/engine`을 import하는 곳은 `app/src/runtime/`뿐이다. UI와 (향후) 에이전트는 `PuppetRuntime`(Iki일 때는 `IkiRuntime`)만 본다.
- 모델 변경은 반드시 `ModelSession.apply(EditCommand)`로 한다. 런타임 모델을 직접 바꾸지 않는다.
- 사람과 에이전트는 같은 관찰(`inspectModel` 스냅샷)과 같은 변경 경로(`EditCommand`)를 쓴다.

## 경계 밖에 있는 것 (Iki가 제공하지 않음)

**Confirmed (공개 API에 없음)**
- 렌더된 프레임 캡처 API
- 변형 후 정점 위치, 디포머 월드 행렬, 파트 화면 경계 조회 (모두 `player.ts` 내부 private)
- 모션(키프레임 애니메이션) 파일 포맷과 재생기. 움직임은 Idle·물리·호스트의 파라미터 구동뿐
- 표정 프리셋
- Idle 모션 세기·주기 설정 (상수가 모듈 내부)
- 물리 체인(`physicsChains`) 편집 명령

**Inference**: 이 중 프레임 캡처, 파라미터 타임라인 재생, 표정 프리셋은 앱 계층에서 만들 수 있다 (모두 파라미터 쓰기와 캔버스 읽기로 표현 가능). 변형 후 기하 조회는 엔진 수정이 필요하다. Iki가 MIT이고 AI 기여를 막지 않으므로, 필요해지면 업스트림 기여나 포크가 가능하다.
