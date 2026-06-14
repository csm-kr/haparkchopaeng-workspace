"use client";

import { DeleteMenu } from "@/components/ui";

// 발표 자료 삭제 — ⋮ 메뉴. 권한은 서버가 발표자(작성자)만 강제(R3), 노출은 페이지에서 작성자에게만.
export function DeletePresentationButton({
  presentationId,
  title,
}: {
  presentationId: string;
  title: string;
}) {
  return (
    <DeleteMenu
      endpoint={`/api/presentations/${presentationId}`}
      redirectTo="/presentations"
      title={title}
      cascadeNote="댓글·버전도 함께 지워져요."
    />
  );
}
