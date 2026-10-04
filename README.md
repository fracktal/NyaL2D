# NyaL2D

AI-native 2D 퍼펫 저작 환경. 사용자가 자연어로 원하는 변화를 말하면 에이전트가 모델을 관찰하고, 되돌릴 수 있는 변경을 적용하고, 브라우저에서 렌더링해 평가하는 것을 목표로 한다.

현재 단계: **Phase 3 초입**. 런타임 조사와 브라우저 프로토타입 위에 에이전트 도구 계층, 에이전트 루프, 로컬 에이전트 서버가 올라가 있다.

- 런타임: [Iki](https://github.com/zeikar/iki) (MIT, `.iki` JSON 포맷, WebGL2). 선택 근거: [docs/runtime/runtime-evaluation.md](docs/runtime/runtime-evaluation.md)
- 런타임 조사: [docs/iki/](docs/iki/README.md)
- 에이전트 도구: [docs/agent/first-capabilities.md](docs/agent/first-capabilities.md)
- 에이전트 루프와 로컬 서버: [docs/agent/agent-loop.md](docs/agent/agent-loop.md)

## 프로토타입 실행

```bash
cd app
npm install
npm run dev        # 앱 + 에이전트 서버를 한 번에. 터미널에 찍힌 주소(기본 http://127.0.0.1:47310/)를 브라우저로 연다
npm run dev:mock   # 에이전트를 모의 응답으로 시험
```

명령 하나, 포트 하나다. 앱 화면, 에이전트 요청(`/llm`), 도구 연결이 모두 같은 주소를 쓴다. 기본 포트 47310이 이미 쓰이고 있으면 다음 빈 포트(47311, 47312…)로 자동으로 옮기고 그 주소를 터미널에 보여 준다. 직접 정하려면 `NYAL2D_PORT=50000 npm run dev`.

에이전트는 `ANTHROPIC_API_KEY`가 있으면 Anthropic API를, 없으면 이 컴퓨터에 로그인된 Claude Code(내 Claude 계정, `claude auth login`)를 쓴다. Claude Code 경로에서는 에이전트 패널에 입력한 요청을 Claude Code가 받아 열린 페이지의 도구만 써서 처리한다(파일·셸·웹 도구는 꺼 둠). 개인·로컬 시험용이며, 다른 사람에게 배포하는 제품은 API 키를 쓴다. 강제로 고르려면 `NYAL2D_LLM_PROVIDER=anthropic|claude-code|mock`. 터미널의 Claude Code나 Claude Desktop에서 앱을 직접 조작하는 방법은 [docs/agent/agent-loop.md](docs/agent/agent-loop.md#claude-code로-실행하기-api-키-없이)에 있다.

Node 22.18 이상이 필요하다. Windows에서는 WSL2(Ubuntu 등) 안에서 그대로 실행하고, 터미널에 찍힌 주소를 Windows 브라우저로 연다. 저장소는 `/mnt/c` 아래보다 WSL 홈(`~/`)에 두는 편이 설치와 파일 감시가 빠르다. Windows 쪽 프로그램이 같은 포트를 쓰고 있으면 WSL은 그걸 알 수 없으니, 그때는 `NYAL2D_PORT`로 다른 번호를 준다.

- 샘플 모델(`hero.iki`, Iki 저장소의 플레이그라운드 모델)이 자동으로 열린다. `열기`나 스테이지에 `.iki`를 끌어다 놓아 다른 모델을 연다.
- **Parameters**: 머리·눈·눈썹·입·몸·물리 출력별 그룹, 검색, 값 직접 입력, 더블클릭으로 기본값. `Idle`/`물리` 표시는 모션 드라이버가 매 프레임 쓰는 값.
- **스테이지**: Iki 플레이어 캔버스. 상단 `Idle / 물리만 / 정지`로 모션 모드 전환. 로딩·빈 상태·오류(검증 메시지 표시) 처리.
- **Inspector**: 개요 / 물리 / 파트 / 디포머 탭. 물리 탭은 리그마다 계단 응답 곡선과 최대·오버슈트·정착 시간을 보여 주고, 값을 바꾸면 원본 곡선과 겹쳐 비교한다.
- **에이전트**(오른쪽 패널의 `에이전트` 탭, `Ctrl+J`): 자연어로 요청하면 에이전트가 도구로 모델을 살펴보고, 바꾸고, 시뮬레이션으로 확인한다. 각 단계가 분석·계획·변경·평가로 표시되고, 바뀐 내용은 변경 기록에 `AI`로 남아 Undo로 되돌릴 수 있다. API 키는 로컬 앱 서버에만 있고 브라우저에는 들어오지 않는다.
- **Changes**: 원본 → #1 → #2 … 타임라인. Undo/Redo(`Ctrl+Z`, `Ctrl+Shift+Z`), 원본으로.
- 카메라 버튼은 현재 프레임 PNG, `내보내기`는 검증된 `.iki`를 저장한다.
- **설정**(슬라이더 아이콘, `Ctrl+,`): 런타임 선택. Iki(내장, 전체 기능) 또는 Ayagami 슬롯(외부 어댑터 모듈을 블랙박스로 연결). 어댑터 규약: [docs/runtime/adapter-contract.md](docs/runtime/adapter-contract.md). Ayagami 슬롯에는 규약 모양만 갖춘 빈 래퍼(`app/public/adapters/ayagami-adapter.js`)가 기본으로 들어 있어 고르면 "미연결" 상태가 표시된다. 사람이 래퍼의 TODO를 채우면 연결되며, `예제 어댑터로 시험`으로 연결 경로를 미리 확인할 수 있다.
- 다크/라이트는 시스템 설정을 따른다. 글꼴은 Pretendard·JetBrains Mono를 번들에 포함한다(외부 요청 없음).

## 검증

```bash
cd app
npm test           # 단위 테스트 (인스펙션, 변경 세션, 헤드리스 물리, 에이전트 도구·루프, 앱 서버 라우팅, 도구 허브·Claude Code 출력 파싱)
npm run build      # 타입 체크 + 번들
npm run smoke      # headless Chromium에서 로드·렌더·캡처·물리·편집·undo·에이전트(모의 응답) 확인
                   # (CHROMIUM_PATH로 브라우저 경로 지정 가능)
```

## 라이선스 메모

`app/public/models/hero.iki`는 [zeikar/iki](https://github.com/zeikar/iki)의 `examples/playground/public/hero.iki`를 그대로 가져온 것이다 (MIT © Zeikar).
