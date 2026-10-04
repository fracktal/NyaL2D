# 모듈 개요

모든 항목은 **Confirmed** (npm 패키지의 `dist/index.d.ts`와 각 README) 기준이다. 버전은 `format 0.2.1`, `engine 0.3.4`, `editor 0.12.1`.

## @ikijs/format

| export | 역할 |
|---|---|
| `IkiModel` 외 타입 | `.iki` v1 스키마 (`types.ts`) |
| `IKI_FORMAT_VERSION` | 현재 `1`. 1.0 전까지는 버전 변경 없이 스키마가 바뀔 수 있다 |
| `parseIkiModel(input)` | 임의 입력을 검증·정규화. 실패 시 `IkiFormatError`(경로 포함 메시지) |
| `loadIkiModel(json)` | JSON 문자열 → `parseIkiModel` |
| `StandardParameter` | 권장 파라미터 id (`ParamAngleX`, `ParamBreath`, `ParamHairSwayX` 등 16개). Live2D 표준 이름을 따르며 Left/Right는 캐릭터 기준 |

## @ikijs/engine

| export | 역할 |
|---|---|
| `IkiPlayer(canvas)` | `load` / `start` / `stop` / `setParameter` / `getParameter` / `getParameters` / `destroy` |
| `IkiLoadResult` | `{ failedTextures, superseded }` |
| `ParameterStore` | 범위 클램프되는 파라미터 맵. 알 수 없는 id와 비유한 값은 무시 |
| `IkiMotion(model, read, sink)` | Idle → Physics → Chain 순서로 묶은 드라이버. `drivenParameterIds` 제공 |
| `IdleMotion(sink, {rng?})` | 깜빡임·호흡·시선·머리 흔들림. 타이밍 상수는 모듈 내부(설정 불가) |
| `PhysicsMotion(rigs, params, read, sink)` | `model.physics` 스프링 |
| `HairChainMotion(chains, params, deformers, read, sink)` | `model.physicsChains` 체인 |
| `translate`, `rotate`, `scale`, `multiply`, `toMat3` | 엔진이 쓰는 2D 아핀 헬퍼 |

공개되지 않은 것: 프레임 단위 렌더 호출(`renderFrame`은 private), 변형된 정점이나 디포머 월드 행렬 조회, 캔버스 캡처 API.

## @ikijs/editor

| 영역 | export |
|---|---|
| 문서 | `EditorDocument`, `EditCommand` |
| 파트 편집 | `AddPart`, `DeletePart`, `SetPartColor/Width/Height/Order/Transform/Bindings/Mesh/Deformer` |
| 디포머 편집 | `AddDeformer`, `DeleteDeformer`, `SetDeformerParent/Transform/Bindings/Pivot(X/Y)`, `CaptureGridKeyform` |
| 물리 편집 | `AddPhysicsRig`, `SetPhysicsRig`, `DeletePhysicsRig` (체인 편집 명령은 없음) |
| 참조 검사 | `validateDeformerReparent`, `validateDeformerDelete`, `validatePartAttach` |
| 아틀라스 | `packAtlas`, `uvRectFor` 등 |
| 오토리그 | `generateIkiFromLayerSet`, `createLayerSetMeasurer` 등 (역할 이름이 붙은 레이어 → 리깅된 모델) |

## @ikijs/mcp (이 앱은 아직 사용하지 않음)

stdio MCP 서버. `.iki` 읽기·검증과 `compose_layers_from_parts`, `measure_layers`, `auto_rig_from_layers`, `measure_turn_reference` 도구를 노출한다 (루트 README). Node 전용(`sharp`).

## 이 저장소의 모듈

```text
app/src/
├── runtime/iki-runtime.ts      앱의 유일한 @ikijs/engine 경계 (로드, 파라미터, 모션 모드, 캡처)
├── runtime/simulate.ts         헤드리스 물리 시뮬레이션
├── model/model-session.ts      원본(동결) + 변경 스택 (EditorDocument 래핑)
├── inspection/inspect.ts       모델 → JSON 스냅샷 (사람·에이전트 공용 관찰)
├── ui/*                        파라미터 슬라이더, 인스펙터, 변경 목록
└── main.ts                     조립, window.nyal2d 디버그 핸들
```
