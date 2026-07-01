# 라이브 카메라 배경 & 오디오 개선 — 설계

- 날짜: 2026-07-02
- 범위: 라이브 룸(LiveKit)의 (1) 카메라 배경 선택(끄기/흐림/이미지) (2) 블러 강도 (3) 마이크 오디오 캡처
- 관련: ADR-019(LiveKit), R7(발표자 grant), R29(색 단독 금지), R30(따뜻한 안내), R32(클라 섬)

## 배경(문맥)

`components/live/meet-controls.tsx`는 현재 "배경 흐림" 단일 토글로, 매 토글마다 `BackgroundProcessor({ mode: "background-blur", blurRadius: 10 })`를 새로 만들어 `setProcessor`/`stopProcessor` 한다(`lib/video-background.ts`의 `setCameraBlur`).

사용자 요청 3가지:
1. 하와이 등 배경 **이미지로 교체** 가능하게
2. 블러가 약함 → **더 강하게**
3. 노이즈캔슬 약함 + **내 목소리 디컴프레션**해서 잘 들리게

## 핵심 기술 사실(코드 확인)

- `@livekit/track-processors@0.7.2`의 `BackgroundProcessor`는 `mode: "virtual-background"`(`imagePath`)를 지원하고, 반환 래퍼에 **`switchTo(options)`** 가 있어 프로세서를 떼지 않고 흐림↔이미지↔강도를 전환한다(깜빡임 방지). → 배경 이미지·강한 블러 모두 **새 의존성 불필요**.
- `livekit-client` 기본 `audioCaptureDefaults`는 이미 `echoCancellation/noiseSuppression/autoGainControl` **모두 true**. → 세 값을 다시 true로 두는 건 무효(no-op). 기본값과 달라지는 유일한 무료 레버는 **`autoGainControl: false`**(음량 자동보정 해제 = 다이내믹 압축 해제 = "디컴프레션").
- 브라우저 내장 noiseSuppression을 넘는 노이즈캔슬 강화는 Krisp(LiveKit Cloud)만 가능 → **이번 범위 밖**.

## 설계

### 1. 배경 선택 모델 — `lib/video-background.ts` 일반화

`setCameraBlur`(불리언 토글)를 배경 선택으로 일반화한다. lib는 상태를 갖지 않고, 프로세서 인스턴스는 호출부가 보유한다(현재 상태를 인자로 받고, 새 상태를 결과로 반환 — 순수 오케스트레이션·GPU 무관 단위테스트 유지).

```ts
export type CameraBackground =
  | { kind: "off" }
  | { kind: "blur"; radius: number }
  | { kind: "image"; path: string };

export type BackgroundOutcome =
  | "applied" | "removed" | "unsupported" | "no-track" | "error";

export interface CameraProcessorTrack {
  setProcessor: (processor: unknown) => Promise<void>;
  stopProcessor: () => Promise<void>;
}
// track-processors BackgroundProcessorWrapper의 부분 타입.
export interface BackgroundProcessorHandle {
  switchTo: (o:
    | { mode: "background-blur"; blurRadius: number }
    | { mode: "virtual-background"; imagePath: string }
    | { mode: "disabled" }) => Promise<void>;
}
export interface BackgroundDeps {
  isSupported: () => boolean;
  createProcessor: (bg: CameraBackground) => BackgroundProcessorHandle;
}
export interface ApplyResult {
  outcome: BackgroundOutcome;
  processor: BackgroundProcessorHandle | null; // 적용 후 상태(off면 null)
}

export async function applyCameraBackground(
  track: CameraProcessorTrack | null | undefined,
  background: CameraBackground,
  current: BackgroundProcessorHandle | null,
  deps: BackgroundDeps,
): Promise<ApplyResult>;
```

분기:
- 트랙 없음 → `no-track`(현재 프로세서 유지).
- `off`: `current` 있으면 `stopProcessor()` → `removed`/`null`; 없으면 아무 호출 없이 `removed`/`null`. 실패는 삼켜 `error`.
- `blur`/`image`: `isSupported()` 아니면 `unsupported`(현재 유지). `current` 있으면 `switchTo(...)`(매끄러운 전환); 없으면 `createProcessor(bg)`+`setProcessor()`. 실패는 삼켜 `error`.
- blur→`{ mode:"background-blur", blurRadius }`, image→`{ mode:"virtual-background", imagePath }`.

### 2. 블러 강도

- 3단계 매핑: **弱=8 / 中=16 / 强=28**(현재 10보다 强이 확실히 셈). 숫자는 미세조정 가능.

### 3. 팝오버 UI — `components/live/meet-controls.tsx`

- "배경 흐림" 단일 버튼 → **"배경" 버튼 + 팝오버**.
- 항목: 끄기 / 흐림(弱·中·强 세그먼트) / 하와이 해변 / 맑은 하늘 / 심플 서재(이미지엔 썸네일).
- 현재 선택 표시는 체크+진하게(색 단독 아님, R29). 버튼 `aria-haspopup`/`aria-expanded`, 항목 `role="menuitemradio"`+`aria-checked`. 바깥 클릭·Esc로 닫힘.
- 예외(R30): 카메라 꺼짐 → "카메라를 먼저 켜주세요"; 미지원 → 흐림·이미지 비활성+안내; 실패 → 따뜻한 안내(기존 notice 재사용).
- 선택은 세션 내 컴포넌트 state만(영속화 없음). 카메라 트랙이 바뀌면(껐다 켬) 선택을 off로 리셋하고 프로세서 ref를 비운다(스테일 트랙 방지).

### 4. 프리셋 이미지 자산

- `/public/backgrounds/`에 WebP 3장(1280×720): `hawaii.webp`·`sky.webp`·`study.webp`.
- **자체 생성**(SVG 스타일라이즈 → sharp로 WebP 래스터화). 라이선스 무관, 파일명 고정 → 나중에 실사로 교체 가능.
- `imagePath`는 `/backgrounds/*.webp` 공개 URL(세그멘터는 blur와 동일 — 별도 설정 불필요).

### 5. 오디오 — `components/live/live-room.tsx`

- `<LiveKitRoom>`에 `options={{ audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: false } }}`.
- 별도 UI 없음. 실제 달라지는 건 `autoGainControl: false` 하나(정직한 한계 — 노이즈캔슬 강화 아님).

## 테스트(TDD)

- `lib/__tests__/video-background.test.ts`: `applyCameraBackground`로 재작성 — off/blur각단계/image의 create·switchTo 인자, current 있을 때 switchTo 재사용, unsupported 게이팅, no-track, error 삼킴(deps 주입, GPU 무관).
- `components/live/__tests__/meet-controls.test.tsx`: 팝오버 열림, 항목 렌더, 흐림 강도·이미지 선택 시 트랙 API 호출, no-track/unsupported 안내, aria 상태.
- `components/live/__tests__/live-room.test.tsx`: `LiveKitRoom`에 전달된 `options.audioCaptureDefaults.autoGainControl === false` 1건(목이 options 캡처).

## 범위 밖(YAGNI)

커스텀 이미지 업로드 · Krisp/Cloud 오디오 · 배경 선택 영속화 · 오디오 토글 UI · 커스텀 EQ/WebAudio.
