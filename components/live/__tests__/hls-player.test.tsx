import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// HlsPlayer 단위 테스트 — URL 부재 시 graceful(던지지 않음, R30).
// hls.js는 동적 import라 여기선 호출되지 않는 경로(src 없음)만 검증한다.
vi.mock("hls.js", () => ({ default: class {} }));

const { HlsPlayer } = await import("@/components/live/hls-player");

afterEach(() => cleanup());

describe("HlsPlayer", () => {
  it("src가 없으면(키 부재) 던지지 않고 '연결을 기다리는 중' 자리로 graceful", () => {
    expect(() => render(<HlsPlayer src="" />)).not.toThrow();
    expect(screen.getByText(/연결을 기다리는 중/)).toBeInTheDocument();
  });
});
