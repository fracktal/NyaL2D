# 자체 2D 퍼펫 엔진 조사 (2026-11-02)

NyaL2D를 "남의 엔진(Iki) 위의 편집 앱"에서 "직접 만드는 2D 퍼펫 엔진" 프로젝트로 바꾸기 위한 조사 결과다. 기존 편집 앱(`app/`)은 잠시 멈춘다.

## 요약

- **엔진이 하는 일**: 그림을 조각(메시)으로 나누고, 슬라이더(파라미터) 값에 따라 미리 만든 예시 모양(키폼)을 섞어 변형한 뒤 화면에 그린다. 여기에 물리(흔들림), 마스크(가리기), 블렌드(색 합성)가 붙는다.
- **참고할 것**: Iki(MIT, AI 환영)는 코드까지 참고할 수 있다. Rive·Godot는 설계만 참고한다. Spine·Live2D SDK는 독자 라이선스라 코드를 쓰지 않는다. Ayagami·Inochi2D는 AI 분석을 거부해서 보지 않았다.
- **추천 구조**: 계산하는 **코어는 Rust**(웹에서는 WebAssembly로), 화면에 그리는 **렌더러는 플랫폼별로 얇게**(웹은 WebGL2 기본 + WebGPU). 같은 코어를 웹·데스크톱·서버·게임 엔진에서 재사용할 수 있다.
- **각도 자동 생성(11-03 결정)**: 실행은 Live2D처럼 각도별 2D 모양을 섞고, 그 각도별 모양은 깊이·얼굴 템플릿 같은 3D 정보로 자동으로 초안을 만든 뒤 사람이나 AI가 다듬는다.
- **파일 형식**: 사람과 AI가 읽을 수 있는 JSON 원본 + 텍스처. 모든 부위에 안정된 ID와 의미 태그를 붙여 AI가 "왼쪽 눈"을 찾을 수 있게 한다.
- **기간**: 슬라이더로 고개를 돌리는 첫 모델까지 약 1.5~2개월, 숨쉬고 흔들리는 캐릭터까지 3~4개월, 편집 앱을 새 엔진에 다시 올리기까지 6~8개월(대략).

## 문서

| 문서 | 내용 |
| --- | --- |
| [how-puppet-engines-work.md](how-puppet-engines-work.md) | 이런 엔진이 어떻게 동작하는지 (형식, 디포머, 키폼, 물리, 마스크, 렌더링) |
| [references-and-licenses.md](references-and-licenses.md) | 참고 엔진·라이브러리와 라이선스, 법적 메모 |
| [architecture.md](architecture.md) | 제안 구조, 언어 선택, 파일 형식 방향, 품질 보증 |
| [roadmap.md](roadmap.md) | 0~8단계 로드맵과 바로 다음 할 일 |
| [live2d-feature-map.md](live2d-feature-map.md) | Live2D 기능 전체 목록과 우리 엔진의 어느 단계에서 만드는지 |
| [auto-angle-generation.md](auto-angle-generation.md) | **결정(11-03)**: 실행은 2D 키폼, 각도별 모양은 3D·AI로 자동 생성하는 설계 |
| [ai-authoring-research.md](ai-authoring-research.md) | 그림 한 장으로 퍼펫을 자동 생성하는 연구들(See-through, Bunraku 등)과 우리에게 주는 시사점 |

## 정해야 할 것

1. 코어 언어: Rust(추천) 또는 전부 TypeScript.
2. 기존 `app/` 처리: 그대로 두고 손대지 않기(추천).
