import { describe, expect, it } from "vitest";
import {
  MAX_IMAGE_BYTES,
  SUPPORTED_IMAGE_TYPES,
  validateImageFile,
} from "@/lib/live-image";

// lib/live-image.ts 단위 테스트 — 라이브 채팅 이미지 첨부 검증(순수 함수, 외부 의존성 없음).
// CRITICAL: 채팅은 휘발이다(R21) — 이미지도 서버/스토리지에 저장하지 않고 LiveKit 바이트 스트림으로
//   룸 참가자에게만 직접 보낸다. 따라서 여기서 막지 못한 큰 파일은 그대로 상대 대역폭을 먹는다.

describe("validateImageFile", () => {
  it("지원 타입 + 크기 이내면 통과(null)", () => {
    expect(validateImageFile({ type: "image/png", size: 1024 })).toBeNull();
  });

  it("지원 타입 목록의 모든 타입을 통과시킨다", () => {
    for (const type of SUPPORTED_IMAGE_TYPES) {
      expect(validateImageFile({ type, size: 1024 })).toBeNull();
    }
  });

  it("이미지가 아닌 타입은 거부한다('type')", () => {
    expect(validateImageFile({ type: "application/pdf", size: 1024 })).toBe("type");
  });

  it("빈 타입도 거부한다('type')", () => {
    expect(validateImageFile({ type: "", size: 1024 })).toBe("type");
  });

  it("한도를 넘는 크기는 거부한다('size')", () => {
    expect(
      validateImageFile({ type: "image/png", size: MAX_IMAGE_BYTES + 1 }),
    ).toBe("size");
  });

  it("한도와 같은 크기는 통과한다(경계 포함)", () => {
    expect(
      validateImageFile({ type: "image/jpeg", size: MAX_IMAGE_BYTES }),
    ).toBeNull();
  });

  it("빈 파일(0바이트)은 거부한다('size')", () => {
    expect(validateImageFile({ type: "image/png", size: 0 })).toBe("size");
  });

  it("타입과 크기가 모두 잘못되면 타입을 먼저 알린다", () => {
    expect(
      validateImageFile({ type: "text/plain", size: MAX_IMAGE_BYTES + 1 }),
    ).toBe("type");
  });
});
