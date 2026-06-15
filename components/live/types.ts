// 라이브 룸 공용 타입 — 패널·컨트롤이 공유한다(import 순환 방지용 분리).

/** 멤버 표시 정보(아바타·이름). AvatarUser + id. live-room의 LiveRoomMember와 동형. */
export interface LiveMember {
  id: string;
  name: string;
  initial: string;
  color: string;
}

/** 수신·표시용 채팅 한 줄. 작성자는 LiveKit identity로 판별한다(R3). */
export interface ChatEntry {
  id: string;
  identity: string;
  text: string;
  at: number;
}

/** 화면에 잠깐 떠오르는 반응 한 개. */
export interface FloatingReaction {
  id: string;
  emoji: string;
  /** 가로 위치(%) — 겹침 방지용 랜덤. */
  left: number;
}
