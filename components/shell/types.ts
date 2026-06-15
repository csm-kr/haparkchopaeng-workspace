// 셸이 서버(RSC 레이아웃)에서 받아 표시하는 멤버 요약.
// Avatar의 AvatarUser({name, initial, color})를 만족한다.
export interface ShellMember {
  id: string;
  name: string;
  initial: string;
  color: string;
  role: string;
  status?: string | null;
}

// 셸 팀 전환용 — 사용자가 속한 팀 요약(서버에서 props로 내려온다, ADR-018).
export interface ShellTeam {
  slug: string;
  name: string;
}
