# Iki 런타임 조사 문서

NyaL2D의 기반 런타임은 [Iki](https://github.com/zeikar/iki)다. 선택 배경은 [../runtime/runtime-evaluation.md](../runtime/runtime-evaluation.md).

조사 기준
- 소스: `zeikar/iki` 커밋 `e0ebdd5` (2026-10-03)
- 사용 패키지: `@ikijs/format@0.2.1`, `@ikijs/engine@0.3.4`, `@ikijs/editor@0.12.1` (npm)
- 실험 환경: 이 저장소의 `app/` + headless Chromium (SwiftShader WebGL2)

근거 등급
- **Confirmed**: Iki 공개 문서(README, 패키지 README, CHANGELOG, 타입 선언, 소스)로 직접 확인
- **Observed**: 이 저장소의 테스트·스모크 스크립트로 재현 (`app/test/*`, `app/scripts/smoke.mjs`, 결과는 `app/observations/*`)
- **Inference**: 위로부터의 추론. 구현 요구사항으로 바로 옮기지 않는다

| 문서 | 내용 |
|---|---|
| [architecture.md](architecture.md) | 패키지 계층과 런타임 구조 |
| [module-overview.md](module-overview.md) | 패키지·모듈별 공개 API |
| [model-loading.md](model-loading.md) | `.iki` 파일 → 검증 → GPU 업로드 |
| [rendering.md](rendering.md) | 프레임 렌더링, 변형 파이프라인, 프레임 캡처 |
| [data-flow.md](data-flow.md) | 파라미터·모션·편집이 화면까지 흐르는 경로 |
| [integration.md](integration.md) | Web App ↔ Iki ↔ 모델 통합 경계 (Task 4) |
| [known-limitations.md](known-limitations.md) | 확인된 제약과 불안정 API |

원래 스펙의 나머지 문서(`parameter-system.md`, `deformation.md`, `physics.md` 등)는 해당 기능을 실제로 구현하며 이해할 때 추가한다.
