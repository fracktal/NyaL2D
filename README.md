# NyaL2D

AI-native 2D 퍼펫 저작 환경. 사용자가 자연어로 원하는 변화를 말하면 에이전트가 모델을 관찰하고, 되돌릴 수 있는 변경을 적용하고, 브라우저에서 렌더링해 평가하는 것을 목표로 한다.

현재 단계: **Phase 3 초입**. 런타임 조사와 브라우저 프로토타입 위에 에이전트 도구 계층, 에이전트 루프, 로컬 LLM 프록시가 올라가 있다.

- 런타임: [Iki](https://github.com/zeikar/iki) (MIT, `.iki` JSON 포맷, WebGL2). 선택 근거: [docs/runtime/runtime-evaluation.md](docs/runtime/runtime-evaluation.md)
- 런타임 조사: [docs/iki/](docs/iki/README.md)
- 에이전트 도구: [docs/agent/first-capabilities.md](docs/agent/first-capabilities.md)
- 에이전트 루프와 LLM 프록시: [docs/agent/agent-loop.md](docs/agent/agent-loop.md)

## 프로토타입 실행

```bash
cd app
npm install
npm run dev        # 브라우저에서 Vite URL 열기
npm run proxy      # (다른 터미널) 에이전트용 로컬 LLM 프록시. ANTHROPIC_API_KEY 필요
npm run proxy:mock # 키 없이 에이전트 UI를 시험하는 모의 응답 프록시
```

- 샘플 모델(`hero.iki`, Iki 저장소의 플레이그라운드 모델)이 자동으로 열린다. `열기`나 스테이지에 `.iki`를 끌어다 놓아 다른 모델을 연다.
- **Parameters**: 머리·눈·눈썹·입·몸·물리 출력별 그룹, 검색, 값 직접 입력, 더블클릭으로 기본값. `Idle`/`물리` 표시는 모션 드라이버가 매 프레임 쓰는 값.
- **스테이지**: Iki 플레이어 캔버스. 상단 `Idle / 물리만 / 정지`로 모션 모드 전환. 로딩·빈 상태·오류(검증 메시지 표시) 처리.
- **Inspector**: 개요 / 물리 / 파트 / 디포머 탭. 물리 탭은 리그마다 계단 응답 곡선과 최대·오버슈트·정착 시간을 보여 주고, 값을 바꾸면 원본 곡선과 겹쳐 비교한다.
- **에이전트**(오른쪽 패널의 `에이전트` 탭, `Ctrl+J`): 자연어로 요청하면 에이전트가 도구로 모델을 살펴보고, 바꾸고, 시뮬레이션으로 확인한다. 각 단계가 분석·계획·변경·평가로 표시되고, 바뀐 내용은 변경 기록에 `AI`로 남아 Undo로 되돌릴 수 있다. API 키는 로컬 프록시에만 있고 브라우저에는 들어오지 않는다.
- **Changes**: 원본 → #1 → #2 … 타임라인. Undo/Redo(`Ctrl+Z`, `Ctrl+Shift+Z`), 원본으로.
- 카메라 버튼은 현재 프레임 PNG, `내보내기`는 검증된 `.iki`를 저장한다.
- **설정**(슬라이더 아이콘, `Ctrl+,`): 런타임 선택. Iki(내장, 전체 기능) 또는 Ayagami 슬롯(외부 어댑터 모듈을 블랙박스로 연결). 어댑터 규약: [docs/runtime/adapter-contract.md](docs/runtime/adapter-contract.md). Ayagami 슬롯에는 규약 모양만 갖춘 빈 래퍼(`app/public/adapters/ayagami-adapter.js`)가 기본으로 들어 있어 고르면 "미연결" 상태가 표시된다. 사람이 래퍼의 TODO를 채우면 연결되며, `예제 어댑터로 시험`으로 연결 경로를 미리 확인할 수 있다.
- 다크/라이트는 시스템 설정을 따른다. 글꼴은 Pretendard·JetBrains Mono를 번들에 포함한다(외부 요청 없음).

## 검증

```bash
cd app
npm test           # 단위 테스트 (인스펙션, 변경 세션, 헤드리스 물리, 에이전트 도구·루프, 프록시 매핑)
npm run build      # 타입 체크 + 번들
npm run smoke      # headless Chromium에서 로드·렌더·캡처·물리·편집·undo·에이전트(모의 프록시) 확인
                   # (CHROMIUM_PATH로 브라우저 경로 지정 가능)
```

## 라이선스 메모

`app/public/models/hero.iki`는 [zeikar/iki](https://github.com/zeikar/iki)의 `examples/playground/public/hero.iki`를 그대로 가져온 것이다 (MIT © Zeikar).
