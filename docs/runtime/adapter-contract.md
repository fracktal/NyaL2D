# 외부 런타임 어댑터 규약 (v1)

NyaL2D는 기본 내장 런타임(Iki) 외에, 이 규약을 따르는 **ES 모듈 하나**를 외부 런타임으로 불러올 수 있다. 앱은 모듈 내부를 모른 채 아래 함수만 호출한다(블랙박스). 설정 화면(상단 슬라이더 아이콘, 또는 `Ctrl+,`)에서 런타임을 고르고 모듈 URL을 지정한다.

> Ayagami 슬롯도 이 규약으로 연결한다. **Ayagami용 어댑터는 이 저장소에 포함되어 있지 않다.** Ayagami 저장소의 `AGENTS.md`가 AI 에이전트의 리서치·코드 분석·코드 작성을 거절해 달라고 요청하므로, 이 프로젝트의 AI 세션은 Ayagami 소스를 읽거나 어댑터를 작성하지 않았다. 어댑터는 사람이 Ayagami를 wasm으로 빌드해 아래 규약에 맞게 감싸면 된다. (참고: 그 관리자들은 AI를 써서 Ayagami를 조사한 사람의 업스트림 기여를 받지 않는다고 밝히고 있다.)

## 모듈이 내보낼 것

```ts
export const nyal2dAdapter = 1;               // 규약 버전. 정확히 1이어야 한다

export const meta = {
  name: "My runtime",                         // 필수. UI에 표시
  version: "0.1.0",                           // 선택
  accept: ".moc3,.zip",                       // 선택. 파일 선택창 accept 값
  motionModes: ["idle"],                      // 선택. "off" 외에 지원하는 모션 모드
};

export async function create(canvas: HTMLCanvasElement): Promise<AdapterInstance>;
```

`create()`는 앱이 런타임 전용으로 새로 만든 `<canvas>`를 받는다. 어댑터는 이 캔버스에 원하는 컨텍스트(WebGL2, WebGPU, 2D)를 만들고 자체 렌더 루프를 돌린다. 캔버스의 CSS 크기는 앱이 정하므로, 드로잉 버퍼는 `clientWidth × devicePixelRatio`에 맞추는 것을 권장한다.

## AdapterInstance

| 멤버 | 필수 | 설명 |
|---|---|---|
| `load(files: File[]): Promise<void>` | 예 | 사용자가 고른 파일(여러 개 가능)로 모델을 연다. `load([])`는 어댑터 내장 샘플이 있으면 그것을 연다(없으면 오류를 던진다). 실패하면 사람이 읽을 수 있는 메시지로 `throw` |
| `parameters(): {id, name?, min, max, default}[]` | 예 | `load()` 후 호출된다. `min < max`, 모든 값이 유한해야 하며 아닌 항목은 무시된다 |
| `getParameter(id): number` | 예 | 현재 값 |
| `setParameter(id, value): void` | 예 | 앱이 `[min, max]`로 클램프한 값만 넘긴다 |
| `destroy(): void` | 예 | 렌더 루프와 GPU 자원 정리. 이후 캔버스는 버려진다 |
| `modelName(): string` | 아니오 | 상단 바 표시용 |
| `setMotionMode(mode): void` | 아니오 | `meta.motionModes`에 있는 모드나 `"off"` |
| `drivenParameterIds(): string[]` | 아니오 | 어댑터 자체 모션이 매 프레임 쓰는 파라미터. 앱이 이 값들을 매 프레임 읽어 UI에 반영한다 |
| `capture(type): Promise<Blob>` | 아니오 | 현재 프레임 이미지. 없으면 앱이 다음 `requestAnimationFrame`에서 `canvas.toDataURL()`로 읽는다. WebGL에서 `preserveDrawingBuffer: false`라면 자체 rAF 루프에서 그리는 한 이 방식으로 읽힌다(docs/iki/rendering.md의 관찰). 다른 방식으로 그린다면 `capture`를 구현하라 |

## 앱이 보장하는 것

- 함수는 위 순서로만 호출된다: `create` → `load` → (`parameters`, `get/setParameter`, `setMotionMode`, `capture`)* → `destroy`.
- 런타임을 바꾸면 이전 인스턴스의 `destroy()`가 먼저 호출되고 새 캔버스가 만들어진다.
- 모듈 URL은 페이지 기준으로 해석되어 동적 `import()`로 로드된다. 다른 출처라면 CORS 헤더가 필요하다.

## 외부 런타임에서 쓸 수 없는 기능

규약에 없는 기능은 UI에서 비활성화되고 인스펙터의 Capabilities에 표시된다.

| 기능 | 외부 런타임 |
|---|---|
| 파라미터 조작, 렌더, 캡처 | 가능 |
| 어댑터 자체 모션 | `meta.motionModes`에 따라 |
| 파트·디포머·물리 구조 조회 | 불가 (규약에 없음) |
| 모델 편집·되돌리기·내보내기 | 불가 (Iki 편집 코어 전용) |
| 헤드리스 물리 시뮬레이션 | 불가 (Iki 드라이버 전용) |

규약을 넓히는 것은 실제 어댑터가 생기고 필요가 확인될 때 한다.

## 예제

[`app/public/adapters/example-adapter.js`](../../app/public/adapters/example-adapter.js)는 모든 멤버를 구현한 참고용 어댑터다(Canvas 2D로 그린 간단한 얼굴). 설정 화면의 **예제 어댑터로 시험**이 이 모듈을 불러온다. 앱의 외부 런타임 경로는 이 예제로 단위 테스트(`app/test/adapter.test.ts`)와 브라우저 스모크 테스트(`app/scripts/smoke.mjs`)에서 검증된다.
