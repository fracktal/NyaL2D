# Live2D 런타임 후보 비교

작성일: 2026-10-04 · 상태: 검토용 초안 (런타임 미확정)

이 문서는 NyaL2D의 기반 런타임을 정하기 위한 비교다. 모든 기술적 주장에는 근거 등급을 붙인다.

- **Confirmed**: 공식 문서, 공개 소스, 라이선스 원문으로 직접 확인
- **Observed**: 이 환경에서 직접 실행해 확인
- **Inference**: 위 근거로부터의 추론. 사실로 취급하지 않는다

> 법률 관련 항목은 라이선스 원문을 읽고 요약한 것이며 법률 자문이 아니다. 상용화 전에는 원문 확인이 필요하다.

---

## 1. 요약

| 후보 | Live2D(.moc3) 호환 | 라이선스 | 웹 통합 | AI 기반 작업 가능성 | 성숙도 |
|---|---|---|---|---|---|
| Ayagami | 예 | MIT / Apache-2.0 | Rust → wasm 직접 빌드 필요 | **관리자가 AI 리서치·분석·문서화를 거절해 달라고 명시** | 초기, API 불안정 |
| Cubism SDK for Web (공식) | 예 (5.3까지) | Core: 독점, Framework: Live2D Open Software | TypeScript + WebGL, 공식 샘플 있음 | 라이선스상 별도 제약 문구는 없음 | 상용 수준 |
| PixiJS 계열 래퍼 (pixi-live2d-display 등) | 예 | 래퍼는 MIT, 내부적으로 Cubism Core 필요 | PixiJS 위 고수준 API | Cubism SDK와 동일 | 커뮤니티 유지 |
| Inochi2D | 아니오 (자체 포맷) | BSD-2 | wasm 빌드 존재 | 제약 없음 | 활발, Live2D와 별개 생태계 |
| Iki | 아니오 (자체 JSON 포맷) | MIT | TypeScript + WebGL2 | MCP 서버로 에이전트 리깅 지원을 표방 | 0.x, 매우 초기 |

**추천 (Inference)**: 사용자가 기존 Live2D 모델을 불러와 편집하는 것이 목표라면 **Cubism SDK for Web**이 현실적인 유일한 선택지다. Live2D 호환을 포기할 수 있다면 Inochi2D 또는 Iki가 라이선스상 가장 자유롭다. 세부 근거는 아래와 같다.

---

## 2. Ayagami

**Confirmed** ([저장소](https://github.com/AyagamiDev/ayagami), README·Cargo.toml·AGENTS.md 기준, 커밋 `0d1d7aa`, 2026-09-14)
- Rust 라이브러리. 크레이트 구성: `ayagami`(코어/파일/드라이버), `ayagami-render`(wgpu 렌더러, WebGL/WebGPU 백엔드), `ayagami-demo`(egui 데모).
- MOC3 SDK 5.0까지 로딩, 물리 엔진 지원. 모션·표정·포즈 파일은 미지원(TODO).
- "API is pretty unstable … there is no documentation yet". JS/C API와 임베드용 웹 컴포넌트는 TODO.
- `AGENTS.md`가 AI 에이전트에게 코드 작성뿐 아니라 리서치, 코드 분석, 문서화를 포함한 모든 관여를 거절해 달라고 요청한다. AI로 조사한 사람은 향후 업스트림 기여가 거부된다고 명시한다.

**판단**: 라이선스상 사용은 가능하지만 관리자의 명시적 의사와 정면 충돌한다. 사용자 결정에 따라 소스 분석은 하지 않았다. 원래 스펙의 "Ayagami 내부를 조사해 문서화" 계획은 이 후보로는 진행할 수 없다.

---

## 3. Cubism SDK for Web (공식)

### 3.1 구성과 배포
**Confirmed**
- 세 부분으로 구성: Cubism Core(독점, 바이너리 JS), [CubismWebFramework](https://github.com/Live2D/CubismWebFramework)(TypeScript 소스 공개), [CubismWebSamples](https://github.com/Live2D/CubismWebSamples).
- Core는 GitHub에 없다. 공식 사이트의 SDK 패키지에서 받아 `Core/`에 복사해야 한다 (Samples README).
- 재배포 가능 파일: `live2dcubismcore.d.ts`, `live2dcubismcore.js`, `live2dcubismcore.min.js` (`Core/RedistributableFiles.txt`).
- 렌더러는 WebGL 구현만 있다 (`src/rendering/*_webgl.ts`). WebGPU 구현은 Framework 소스에 없다.
- Framework 최신 릴리스 `5-r.5` (2026-04-02), Cubism 5.3 대응.

**Observed**
- 이 컨테이너의 네트워크 정책이 `cubism.live2d.com`을 차단한다 (CONNECT 403). 여기서는 Core를 받아 실행 실험을 할 수 없다. 사용자의 브라우저나 기기에서는 문제없다.
- npm의 `live2dcubismcore`(1.0.2)는 라이선스가 `ISC`로 표기돼 있으나 Core는 독점 라이선스다. 비공식 재배포로 보이며 의존하지 않는 것이 안전하다 (Inference).

### 3.2 Core가 노출하는 런타임 표면
**Confirmed** (Framework `src/model/cubismmodel.ts`가 Core 모델 객체에서 읽는 필드)

```text
Live2DCubismCore.Moc.fromArrayBuffer(.moc3)
        ↓
Live2DCubismCore.Model.fromMoc(moc)
        ├── parameters: ids, values, min/max/default, types, repeats   (values 쓰기 가능)
        ├── parts:      ids, opacities, parentIndices, offscreenIndices
        ├── drawables:  ids, vertexPositions, vertexUvs, indices, opacities,
        │               masks, blendModes, textureIndices, parentPartIndices,
        │               multiply/screen colors, constant/dynamic flags
        ├── offscreens: (5.3 블렌드/오프스크린)
        ├── canvasinfo: CanvasWidth/Height, PixelsPerUnit
        └── update()    ← 파라미터 → 최종 메시 계산
```

- Framework 소스 어디에도 deformer(워프/회전 디포머)에 대한 참조가 없다 (`grep -i deformer` 결과 0건).

**Inference**: Core는 디포머 계층과 키폼을 외부에 노출하지 않는 것으로 보인다. 즉 **런타임에서 디포머나 메시 구조를 읽거나 수정할 수 없다.** 에이전트가 볼 수 있는 것은 파라미터, 파트, 최종 변형된 드로어블이다. 원래 스펙의 `inspect_deformers` 도구는 이 런타임으로는 구현할 수 없다.

### 3.3 앱 계층에서 편집 가능한 것
**Confirmed** (Framework 소스)
- 물리: `physics3.json`을 `CubismPhysics.parse()`가 읽고, 입력/출력 파라미터 매핑과 입자별 `Mobility`, `Delay`, `Acceleration`, `Radius`, 정규화 범위를 가진다 (`src/physics/cubismphysicsjson.ts`). 시뮬레이션은 `evaluate(model, dt)`, 안정화는 `stabilization(model)`.
- 호흡: `CubismBreath`는 파라미터마다 `offset`, `peak`, `cycle`, `weight`의 사인파로 값을 더한다 (`src/effect/cubismbreath.ts`).
- 모션(`motion3.json`), 표정(`exp3.json`), 포즈(`pose3.json`), 눈 깜빡임, 시선 추적(`cubismlook`)이 모두 Framework(공개 TS)에 구현돼 있고 JSON 설정으로 구동된다.

**Inference (스펙과의 연결)**: `.moc3`는 건드리지 않고 이 JSON 설정 계층만 바꿔도 스펙의 예시 요청 상당수를 다룰 수 있다.

| 요청 예시 | 다룰 수 있는 계층 |
|---|---|
| "은은하게 숨 쉬게 해줘" | `CubismBreath` 파라미터 또는 호흡 모션 |
| "머리카락이 고개를 더 자연스럽게 따라오게" | `physics3.json` 입자 파라미터 |
| "가슴 흔들림 추가" | 해당 물리 출력 파라미터가 모델에 **이미 있을 때만** `physics3.json`으로 가능. 없으면 `.moc3`의 디포머 작업이 필요해 Cubism Editor 영역 |
| "몸 움직임을 덜 딱딱하게" | 모션 커브, 물리 입력 가중치 |

이 구조는 스펙의 "원본 비파괴, 변경을 명시적 diff로 관리" 원칙과도 잘 맞는다. 원본 JSON 위에 변경 세트를 쌓으면 된다.

### 3.4 라이선스
**Confirmed** (원문 요약)
- Framework·Samples: [Live2D Open Software License](https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html). 수정·포팅은 계약이 허용하는 범위로 제한되고, 경쟁 소프트웨어·미들웨어와 함께 쓰는 것을 금지하는 조항이 있다.
- Core: [Live2D Proprietary Software License](https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html). 역공학 금지, 지정 파일만 재배포 가능.
- 연매출 1,000만 엔 이상 사업자는 출시 라이선스 필요. 개인과 소규모 사업자는 면제 (Samples `LICENSE.md`, [SDK 라이선스 안내](https://www.live2d.com/en/sdk/license/)). 개발·시험 단계에는 불필요.
- 샘플 모델(Haru, Hiyori 등)은 모델별 별도 약관.

**Inference / 확인 필요**
- 경쟁 미들웨어 조항 때문에 Ayagami와 Cubism Framework를 한 앱에서 섞는 구성은 피하는 게 안전하다.
- "모델을 수정하는 저작 도구"가 출시 라이선스상 어떤 플랜(확장형 애플리케이션 등)에 해당하는지는 원문만으로 판단하기 어렵다. 공개·상용 배포 전에 Live2D에 문의가 필요하다.

---

## 4. PixiJS 계열 래퍼

**Confirmed** (npm 메타데이터)
- `pixi-live2d-display` 0.4.0, `untitled-pixi-live2d-engine` 1.4.0(PixiJS v8, Cubism 2–5), `easy-live2d` 1.0.0 등. 모두 MIT.

**Inference**: 내부적으로 Cubism Core가 필요하므로 라이선스 조건은 3.4와 같다. 고수준 API가 편하지만, 에이전트 관찰용으로 Core 필드에 직접 접근해야 하는 이 프로젝트에선 추상화 한 겹이 오히려 방해가 될 수 있다. 공식 Framework를 직접 쓰는 편이 투명하다.

---

## 5. Inochi2D

**Confirmed** ([저장소](https://github.com/Inochi2D/inochi2d))
- BSD-2, D 언어 + C FFI, wasm 빌드 제공(0.9부터 사전 빌드). 자체 포맷 `.inp`/`.inx`. 리깅 도구 Inochi Creator가 오픈소스로 있다.

**Inference**: 포맷이 열려 있어 디포머·메시까지 에이전트가 읽고 쓰는 "진짜 저작"이 가능하다. 대신 기존 Live2D 모델 자산은 쓸 수 없다.

---

## 6. Iki

**Confirmed** ([저장소](https://github.com/zeikar/iki))
- MIT, TypeScript, WebGL2. 자체 JSON 스키마이며 `.moc3` 임포터 없음. 워프·그리드 변형, 클리핑 마스크, 스프링 물리 지원. 0.x로 스키마가 바뀔 수 있음. 에이전트용 MCP 서버(레이어로부터 자동 리깅 등)를 제공한다고 밝힌다.

**Inference**: 이 프로젝트의 철학과 가장 비슷하지만 성숙도가 낮고 Live2D 모델과 호환되지 않는다.

---

## 7. 결정이 필요한 질문

1. **Live2D 모델 호환이 필수인가?**
   - 예 → Cubism SDK for Web. 런타임 저작 범위는 "파라미터 + JSON 설정(물리·모션·표정·호흡)"으로 한정된다. 디포머 수준 편집은 범위 밖.
   - 아니오 → Inochi2D(성숙) 또는 Iki(초기). 디포머까지 편집 가능.
2. Cubism SDK를 택할 경우 **Core 파일을 사용자가 직접 받아 넣는 방식**으로 갈지. 저장소에 Core를 커밋하지 않고, 앱이 사용자가 지정한 경로나 업로드에서 Core를 로드하는 방식이 라이선스상 가장 보수적이다 (Inference).

## 8. 다음 단계 (런타임 확정 후)

원래 스펙 21절 Task 2–5를 선택된 런타임 기준으로 진행한다. `docs/ayagami/` 대신 런타임 이름에 맞는 문서 디렉터리를 만들고, 같은 근거 등급 규칙을 따른다.
