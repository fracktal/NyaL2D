# 첫 에이전트 기능 제안

스펙 21절 Task 5의 결과다. **아직 구현하지 않았다.** 아래 도구는 모두 `docs/iki/`에서 확인되었거나(Confirmed) 이 저장소에서 실제로 돌려 본(Observed) 런타임 동작 위에만 올린다.

## 원칙

1. **도구 = 검증된 런타임 동작 하나.** 각 도구는 `IkiRuntime`, `ModelSession`, `inspectModel`, `simulatePhysics` 중 하나의 기존 메서드를 감싼다. 새 런타임 기능을 전제로 한 도구는 만들지 않는다.
2. **변경은 전부 `EditCommand`로.** 에이전트의 편집은 `ModelSession.apply(cmd, "agent")`로만 들어가며, 사람이 인스펙터에서 하는 편집과 같은 경로·같은 검증·같은 undo를 탄다.
3. **능력 발견.** 에이전트는 시작할 때 `list_capabilities`로 사용 가능한 도구와 그 한계를 받는다. 모델에 물리 리그가 없으면 물리 도구는 목록에 나오지 않는다.
4. **제공자 독립.** 도구 정의는 JSON Schema로 두고, LLM 호출부는 얇은 어댑터로 분리한다. UI는 에이전트 상태(요청·분석·계획·변경·평가)만 구독한다.

## 1차 도구 세트

### 관찰

| 도구 | 감싸는 것 | 반환 | 근거 |
|---|---|---|---|
| `inspect_model` | `inspectModel(session.current)` | 파라미터(범위, usedBy, drivenBy), 파트, 디포머, 물리, 체인, 텍스처 요약 JSON | Observed (`app/test/model.test.ts`) |
| `get_parameters` | `IkiRuntime.snapshotParameters()` + `drivenParameterIds` | 현재 값, 어느 드라이버가 쓰는지 | Confirmed |
| `capture_frame` | `IkiRuntime.captureFrame()` | PNG (선택적으로 특정 파라미터 포즈를 먼저 적용) | Observed (`rendering.md`) |
| `simulate_physics` | `simulatePhysics(model, …)` | 입력 시나리오에 대한 출력 파라미터 궤적 + 요약 지표(최대 오버슈트, 정착 시간, 최종값) | Observed (`app/test/simulate.test.ts`) |
| `list_changes` | `ModelSession.changes` | `{seq, label, source}` 목록 | Observed |

### 행동

| 도구 | 감싸는 것 | 지속성 | 근거 |
|---|---|---|---|
| `set_parameter` | `IkiRuntime.setParameter` | 포즈만 바꿈, 모델 변경 아님 | Confirmed |
| `set_motion_mode` | `IkiRuntime.setMotionMode` (`idle`/`physics`/`off`) | 런타임 상태 | Observed |
| `edit_physics_rig` | `SetPhysicsRig` | 변경으로 기록 | Observed (브라우저 + 단위 테스트) |
| `edit_bindings` | `SetPartBindings`, `SetDeformerBindings` | 변경으로 기록 | Observed (단위 테스트) |
| `undo` / `revert_all` | `ModelSession.undo` / `revertAll` | — | Observed |

### 의도적으로 빼는 것

| 개념 도구 (스펙 8절) | 빼는 이유 |
|---|---|
| `inspect_deformers`의 변형 후 기하 | 엔진이 변형된 정점·행렬을 공개하지 않음 (`integration.md`) |
| 모션·표정 재생 | Iki에 모션·표정 포맷이 없음 |
| 체인 편집, 정점·2D 격자 키폼 편집 | 에디터 코어에 명령이 없음 (`known-limitations.md`) |
| `evaluate`(비전 모델) | 1차는 수치 지표와 사용자 피드백으로 시작. 비전 평가는 Phase 6 |

## 예시 1: "은은하게 숨 쉬게 해줘" (샘플 hero.iki 기준)

모델의 실제 데이터로 따라가 본 계획이다.

1. **관찰** `inspect_model` → `ParamBreath`의 usedBy가 `deformer:bodyDeformer`, `deformer:headDeformer`. 바인딩은 `bodyDeformer: ParamBreath → translateY [0, 4.6]`, `headDeformer: … [0, 2.95]`. drivenBy에는 없고 `get_parameters`로 IdleMotion이 쓴다는 것을 확인 (3.5초 주기, 0..1).
2. **판단** 호흡 주기는 Idle 상수라 바꿀 수 없다. 바꿀 수 있는 것은 진폭(바인딩의 `to`)이다.
3. **행동** `edit_bindings`로 두 디포머의 `ParamBreath` 바인딩 `to`를 줄인다. 두 변경이 각각 기록된다.
4. **평가** `capture_frame`을 `ParamBreath=0`과 `1`에서 찍어 몸통 영역의 이동량을 변경 전후로 비교하고, 사용자에게 Idle 모드 미리보기를 보여 준다.
5. **보존** 변경 목록에 `Set deformer bindings` 2건, 출처 `agent`. 마음에 안 들면 undo.

이 흐름의 3번 편집은 단위 테스트에서 이미 돌려 봤다 (`to` 4.6 → 2.3, 원본 보존, 직렬화 왕복).

## 예시 2: "머리카락이 고개를 더 자연스럽게 따라오게"

1. **관찰** `inspect_model` → 물리 리그 `hairSway`(ParamAngleX → ParamHairSwayX, stiffness 30, damping 3), `hairTilt`.
2. **실험** `simulate_physics`로 `ParamAngleX` 계단 입력의 응답을 얻는다. 현재 값: 약 600ms에 최대 약 7.0, 최종값 약 5 근처로 수렴 (`app/observations/hair-sway-step.json`).
3. **행동** "더 자연스럽게"를 오버슈트·정착 시간 목표로 바꿔 `edit_physics_rig`로 조정하고 다시 시뮬레이션한다. 몇 번 반복한다.
4. **평가** 수치 지표 + Idle 모드 미리보기 + 사용자 판단.

이 반복이 스펙 13절의 최적화기 자리다. LLM은 "자연스럽게"를 목표 지표로 옮기고, 수치 탐색은 나중에 별도 최적화기가 `simulate_physics`를 직접 돌리게 하면 된다. 헤드리스 시뮬레이션이 결정적이고 빠르기 때문에 가능하다.

## 다음 단계 제안 (Phase 3)

1. 위 도구를 `app/src/agent/tools/`에 순수 함수로 구현하고 단위 테스트 (LLM 없이).
2. 에이전트 루프(요청 → 분석 → 계획 → 변경 → 평가)를 상태 머신으로 만들고 UI 하단 패널에 단계를 표시.
3. LLM 어댑터 하나를 붙여 "파라미터 보여줘", "이 모델 설명해줘", "이 파라미터 바꿔줘" 수준부터 시작.

결정이 필요한 것: LLM 호출을 브라우저에서 직접 할지(사용자 API 키 입력), 작은 서버를 둘지.
