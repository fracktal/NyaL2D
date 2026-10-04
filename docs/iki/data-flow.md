# 데이터 흐름

## 1. 파라미터 → 화면

```text
UI 슬라이더 / 모션 드라이버 / (향후) 에이전트
        │ IkiRuntime.setParameter(id, v)
        ▼
IkiPlayer.setParameter → ParameterStore.set   [min, max] 클램프, 미지 id·NaN 무시
        │
        ▼ (다음 rAF)
renderFrame: 바인딩 정규화 (v - min)/(max - min) → [from, to]
             · translate/rotate/scale 은 기본 변환에 더함, opacity 는 곱함
             · 워프 키폼은 값으로 클램프 후 인접 키폼 선형 보간
        ▼
캔버스
```

**Confirmed**: 바인딩 의미는 `IkiBinding` 문서 주석, 키폼 보간은 `IkiWarp`·`IkiGridWarp` 주석, 클램프는 `ParameterStore`.

## 2. 모션 드라이버

```text
rAF (앱의 모션 루프, 플레이어 렌더 루프와 별개)
  └─ update(now)
       ├─ IdleMotion      ParamEyeL/ROpen, ParamBreath(0..1, 3.5초 주기),
       │                  ParamEyeBallX/Y, ParamAngleX/Y/Z(작은 흔들림) 쓰기
       ├─ PhysicsMotion   input 읽기 → 스프링 적분(1/60 s 서브스텝) → output 쓰기
       └─ HairChainMotion 앵커 디포머 회전 읽기 → 체인 적분 → 세그먼트 output 쓰기
```

**Confirmed**: 순서와 이유는 `IkiMotion.update` 주석 ("Order is load-bearing"). 호흡 주기 `BREATH_PERIOD_MS = 3500`.

**Observed**
- Idle이 `ParamAngleX`를 매 프레임 쓰므로, Idle이 켜진 상태에서 호스트가 `ParamAngleX`를 계단 입력으로 줘도 물리 입력은 Idle 값으로 덮인다. 그래서 앱에 "물리만" 모드를 따로 두었다.
- "물리만" 모드에서 `ParamAngleX`를 0 → 30으로 바꾸면 `ParamHairSwayX`가 지연되며 약 6.7까지 오버슈트한 뒤 약 5(= 정규화 입력 1 × weight 1 × scale 5) 근처로 수렴한다. 같은 실험을 헤드리스 시뮬레이션으로 돌린 값(최대 약 7.0, 600ms 부근)과 브라우저 측정값이 일치한다 (`app/observations/hair-sway-step.json`, `browser-smoke.json`).

## 3. 편집 → 화면

```text
인스펙터 입력 (또는 향후 에이전트)
   │ ModelSession.apply(new SetPhysicsRig(id, rig), source)
   ▼
EditorDocument.execute → 후보 검증 → 이전 값 캡처 → 작업 모델 변경
   │ (실패 시 예외, 모델·변경 목록 그대로)
   ▼
ModelSession: 변경 목록에 {seq, label, source} 추가, onChange 알림
   ▼
IkiRuntime.load(session.current)   복제·검증 → 플레이어 재로드 → 파라미터 값 복원 → 모션 드라이버 재생성
   ▼
캔버스 + 인스펙터 + 변경 목록 갱신
```

**Observed** (`browser-smoke.json`의 `afterEdit`, `afterUndo`): 인스펙터에서 `hairSway.stiffness`를 30 → 120으로 바꾸면 변경 1건이 기록되고 런타임 모델이 120이 되며 원본은 30으로 남는다. Undo 후 변경 0건, 런타임 30.

## 4. 원본 보존

```text
ModelSession.original   deep clone + Object.freeze   (절대 변경 안 함)
ModelSession.current    EditorDocument 작업 모델
IkiRuntime 내부 모델     current 의 검증된 복제본
```

세 사본이 분리돼 있어 어느 쪽 변경도 다른 쪽으로 새지 않는다.
