# 알려진 제약과 불안정 요소

## 성숙도·안정성

**Confirmed**
- 모든 패키지가 0.x. "Before 1.0, v1 is unstable: the schema may change … without a version bump." 0.x 릴리스가 이전에 통과하던 모델을 거부할 수 있다 (`AGENTS.md`, README Stability).
- TypeScript API도 0.x 마이너 사이에 바뀔 수 있다.
- 이 저장소는 정확한 버전으로 고정했다 (`app/package.json`: format 0.2.1, engine 0.3.4, editor 0.12.1).

## 포맷

**Confirmed**
- Live2D(`.moc3`) 모델을 열 수 없다. 임포터가 없다.
- 텍스처는 `data:` URI만 지원한다. 외부 경로나 URL은 건너뛴다.
- 디포머당 그리드 워프는 하나(1D 또는 2D)만. 다중 드라이버 그리드 합성, 베지어 워프, 중첩 워프, 글루, 패스 디포머는 미지원 (ROADMAP 4d Deferred).
- 클리핑 마스크는 평면(중첩 불가)이고 반전 마스크 없음.
- 메시 토폴로지 편집(정점 추가·삭제, 삼각분할)은 에디터 코어에 없다 (ROADMAP 5c Deferred).

## 엔진

**Confirmed**
- WebGL2 전용. WebGPU 경로 없음.
- 변형을 CPU에서 계산한다.
- 모션 파일·키프레임 재생, 표정 프리셋 없음.
- Idle 모션의 타이밍·진폭은 모듈 상수로 고정 (`IdleMotionOptions`는 `rng`만 받음).
- `preserveDrawingBuffer` 없음 → 캔버스는 rAF 안에서만 읽을 수 있다 (rendering.md 참고).
- 변형 후 기하(정점, 디포머 행렬, 화면 경계) 조회 API 없음.

**Observed**
- 재로드하면 파라미터가 기본값으로 초기화된다. 앱이 보존 처리를 한다.
- Idle이 `ParamAngleX/Y/Z`를 계속 써서, Idle과 호스트 머리 구동을 동시에 쓰면 호스트 값이 덮인다.

## 에디터 코어

**Confirmed**
- 물리 체인 편집 명령 없음 (ROADMAP 5g Deferred).
- 파트의 정점 키폼(`part.warps`)을 쓰는 명령이 없다. 키폼 명령은 워프 디포머의 1D 격자 키폼용 `CaptureGridKeyform` 하나이고, 2D(`warp2d`) 키폼은 수정 명령이 없다 (`commands.ts`의 export 목록, ROADMAP 5d Deferred).
- `EditorDocument`는 undo/redo 스택을 공개하지 않는다. 앱이 변경 목록을 따로 들고 있다.

## 이 환경의 실험 한계

**Observed**
- 실험은 headless Chromium + SwiftShader(소프트웨어 WebGL2)에서 했다. 실제 GPU 브라우저의 성능·정밀도는 측정하지 않았다.
- `@ikijs/mcp`는 아직 실행해 보지 않았다.

## Inference

- 스펙의 예시 중 "가슴 흔들림 추가"처럼 새 움직임 구조가 필요한 요청은 부분적으로만 가능하다. 디포머 추가, 바인딩, 물리 리그 추가 명령은 있지만 정점·2D 격자 키폼을 쓰는 명령이 없으므로, 그런 편집은 새 `EditCommand`를 앱에 만들거나 Iki에 기여해야 한다. Phase 4 이후의 과제다.
