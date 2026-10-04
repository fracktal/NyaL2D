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

- 샘플 모델(`hero.iki`, Iki 저장소의 플레이그라운드 모델)이 자동으로 열린다. `.iki 열기`로 다른 모델을 불러올 수 있다.
- 왼쪽: 파라미터 슬라이더 (⟲ 표시는 모션 드라이버가 쓰는 파라미터)
- 가운데: Iki 플레이어 캔버스. 상단 `모션`에서 Idle+물리 / 물리만 / 끔 전환
- 오른쪽: 인스펙터 (파라미터·파트·디포머·물리·텍스처). 물리 리그 값은 직접 편집 가능
- 아래: 변경 목록. 편집은 원본을 건드리지 않고 쌓이며 Undo / Redo / 원본으로 가능
- `프레임 캡처`: 현재 렌더 프레임 PNG 저장, `현재 모델 내보내기`: 검증된 `.iki` 저장

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
