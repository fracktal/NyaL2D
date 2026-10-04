# NyaL2D

AI-native 2D 퍼펫 저작 환경. 사용자가 자연어로 원하는 변화를 말하면 에이전트가 모델을 관찰하고, 되돌릴 수 있는 변경을 적용하고, 브라우저에서 렌더링해 평가하는 것을 목표로 한다.

현재 단계: **Phase 0–1** (런타임 조사 + 최소 브라우저 프로토타입). AI 기능은 아직 없다.

- 런타임: [Iki](https://github.com/zeikar/iki) (MIT, `.iki` JSON 포맷, WebGL2). 선택 근거: [docs/runtime/runtime-evaluation.md](docs/runtime/runtime-evaluation.md)
- 런타임 조사: [docs/iki/](docs/iki/README.md)
- 첫 에이전트 기능 제안: [docs/agent/first-capabilities.md](docs/agent/first-capabilities.md)

## 프로토타입 실행

```bash
cd app
npm install
npm run dev        # 브라우저에서 Vite URL 열기
```

- 샘플 모델(`hero.iki`, Iki 저장소의 플레이그라운드 모델)이 자동으로 열린다. `열기`나 스테이지에 `.iki`를 끌어다 놓아 다른 모델을 연다.
- **Parameters**: 머리·눈·눈썹·입·몸·물리 출력별 그룹, 검색, 값 직접 입력, 더블클릭으로 기본값. `Idle`/`물리` 표시는 모션 드라이버가 매 프레임 쓰는 값.
- **스테이지**: Iki 플레이어 캔버스. 상단 `Idle / 물리만 / 정지`로 모션 모드 전환. 로딩·빈 상태·오류(검증 메시지 표시) 처리.
- **Inspector**: 개요 / 물리 / 파트 / 디포머 탭. 물리 탭은 리그마다 계단 응답 곡선과 최대·오버슈트·정착 시간을 보여 주고, 값을 바꾸면 원본 곡선과 겹쳐 비교한다.
- **Changes**: 원본 → #1 → #2 … 타임라인. Undo/Redo(`Ctrl+Z`, `Ctrl+Shift+Z`), 원본으로.
- 카메라 버튼은 현재 프레임 PNG, `내보내기`는 검증된 `.iki`를 저장한다.
- 다크/라이트는 시스템 설정을 따른다. 글꼴은 Pretendard·JetBrains Mono를 번들에 포함한다(외부 요청 없음).

## 검증

```bash
cd app
npm test           # 단위 테스트 (인스펙션, 변경 세션, 헤드리스 물리)
npm run build      # 타입 체크 + 번들
npm run smoke      # headless Chromium에서 로드·렌더·캡처·물리·편집·undo 확인
                   # (CHROMIUM_PATH로 브라우저 경로 지정 가능)
```

## 라이선스 메모

`app/public/models/hero.iki`는 [zeikar/iki](https://github.com/zeikar/iki)의 `examples/playground/public/hero.iki`를 그대로 가져온 것이다 (MIT © Zeikar).
