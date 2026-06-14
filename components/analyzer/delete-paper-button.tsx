"use client";

import { DeleteMenu } from "@/components/ui";

// 논문 삭제 — ⋮ 메뉴. 권한은 서버가 작성자만 강제(R3), 노출은 페이지에서 작성자에게만.
export function DeletePaperButton({
  paperId,
  title,
}: {
  paperId: string;
  title: string;
}) {
  return (
    <DeleteMenu
      endpoint={`/api/papers/${paperId}`}
      redirectTo="/library"
      title={title}
      cascadeNote="분석·노트도 함께 지워져요."
    />
  );
}
