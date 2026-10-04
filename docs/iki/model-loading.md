# 모델 로딩

## 흐름

```text
.iki 파일 (JSON 텍스트, 텍스처는 data: URI로 내장)
   │  file.text() / fetch().text()
   ▼
loadIkiModel(json)  →  parseIkiModel(obj)          @ikijs/format
   │  구조·범위·참조 검증, 실패 시 IkiFormatError("parts[3].mesh.indices length must be …")
   ▼
IkiModel (검증된 평범한 객체)
   │  IkiPlayer.load(model)                         @ikijs/engine
   ▼
텍스처 디코드  (data: → Blob → createImageBitmap, premultiply)
   │  모두 settle될 때까지 대기
   ▼
GPU 업로드  (텍스처, 메시 VBO/IBO)
   │  새 load()나 destroy()가 끼어들면 결과 폐기 (superseded: true)
   ▼
원자적 교체  (model, ParameterStore(defaults), parts, meshes, clip groups)
   ▼
다음 rAF부터 새 모델 렌더
```

## Confirmed

- `loadIkiModel`은 JSON을 파싱한 뒤 `parseIkiModel`에 넘긴다. 검증 실패는 경로가 붙은 `IkiFormatError`다 (`format/src/validate.ts`).
- 검증 예: 메시 정점 65536개 상한, UV는 0..1, 인덱스 길이는 3의 배수, 키폼은 값 오름차순, `warp2d`의 두 축 파라미터는 서로 달라야 함, 워프 격자는 정렬된 축 정렬 격자.
- 텍스처는 `data:` URI만 디코드한다. 외부 URL은 경고 후 건너뛴다 ("external texture sources are unsupported in v1").
- 텍스처 디코드·업로드 실패는 치명적이지 않다. 해당 인덱스가 `failedTextures`에 담기고 그 텍스처를 쓰는 파트는 그려지지 않는다.
- 메시 버퍼 업로드 실패는 치명적이며 `load()`가 예외를 던진다.
- `load()`가 끝나기 전에 `getParameters()`를 부르면 빈 배열을 돌려주고 콘솔 에러로 알린다. 반드시 `await load()` 후 읽어야 한다.
- 새 모델의 파라미터는 `default`(범위로 클램프)에서 시작한다.
- 플레이어는 받은 모델 객체의 참조를 보관한다 (`this.model = model`).

## Observed

- 샘플 `hero.iki`(약 700 KB, 텍스처 2장, 파트 15, 디포머 8, 물리 리그 2)가 headless Chromium에서 `failedTextures` 없이 로드되고 렌더된다 (`app/observations/browser-smoke.json`).
- 재로드하면 파라미터가 기본값으로 돌아간다. 그래서 앱의 `IkiRuntime.load()`는 재로드 전 값을 저장했다가 새 모델에 다시 써 넣는다 (`app/src/runtime/iki-runtime.ts`).

## Inference

- 플레이어가 모델 참조를 보관하고 메시를 로드 시점에 업로드하므로, 모델 객체를 제자리에서 바꾸면 일부(바인딩 값)만 반영되고 메시·텍스처·클리핑은 반영되지 않는 어중간한 상태가 될 수 있다. 앱은 플레이어에 항상 복제본을 넘기고, 편집 후에는 `load()`로 다시 올린다.
- 큰 텍스처를 가진 모델은 편집마다 재로드 비용(이미지 디코드)이 든다. 현재 샘플에서는 체감되지 않지만, 잦은 수치 탐색은 헤드리스 시뮬레이션(`simulate.ts`)으로 돌리는 편이 맞다.
