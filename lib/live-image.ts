// 라이브 채팅 이미지 첨부 — 검증(순수 함수, 외부 의존성 없음).
// CRITICAL: 채팅은 휘발이다(R21) — 이미지도 서버/스토리지에 저장하지 않는다.
//   LiveKit 바이트 스트림으로 룸 참가자에게만 직접 보내고, 룸을 나가면 사라진다.
// CRITICAL: 그래서 크기 제한이 곧 상대방 대역폭 보호다 — 여기서 못 막으면 그대로 나간다.

/** 룸으로 직접 보내므로 원본 그대로 나간다 — 대역폭을 생각한 상한. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** 브라우저가 <img>로 바로 그릴 수 있는 형식만. */
export const SUPPORTED_IMAGE_TYPES: readonly string[] = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
];

/** 거절 사유 — 안내 문구는 호출부(UI)가 정한다. */
export type ImageRejectReason = "type" | "size";

/**
 * 첨부하려는 파일이 보낼 수 있는 이미지인지. 통과하면 null, 아니면 사유.
 * 타입을 먼저 본다 — 형식이 틀리면 크기는 알려줄 이유가 없다.
 */
export function validateImageFile(file: {
  type: string;
  size: number;
}): ImageRejectReason | null {
  if (!SUPPORTED_IMAGE_TYPES.includes(file.type)) return "type";
  if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) return "size";
  return null;
}
