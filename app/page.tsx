import { FileText } from "lucide-react";
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Skeleton,
} from "@/components/ui";

/**
 * 디자인 시스템 미리보기 — 도메인 화면 아님(step1 범위).
 * 토큰 기반 기본 컴포넌트가 라이트/다크에서 렌더되는지 확인용.
 */
export default function Home() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 p-10">
      <h1 className="text-[28px] font-bold tracking-[-0.025em]">
        하박조팽 — 디자인 시스템
      </h1>

      <section className="flex flex-wrap gap-2">
        <Button variant="primary">기본</Button>
        <Button variant="secondary">보조</Button>
        <Button variant="ghost">고스트</Button>
        <Button variant="danger">내보내기</Button>
      </section>

      <section className="flex flex-wrap items-center gap-2">
        <Badge variant="admin">관리자</Badge>
        <Badge variant="member">멤버</Badge>
        <Badge variant="guest">게스트</Badge>
        <Badge variant="online">온라인</Badge>
        <Badge variant="away">자리비움</Badge>
        <Badge variant="busy">바쁨</Badge>
      </section>

      <section className="flex items-center gap-3">
        <Avatar user={{ name: "하수현", initial: "하", color: "var(--m-ha)" }} />
        <Avatar
          user={{ name: "박진희", initial: "박", color: "var(--m-bak)" }}
          size="lg"
        />
        <Avatar
          user={{ name: "조성민", initial: "조", color: "var(--m-jo)" }}
          size="xl"
        />
      </section>

      <Card className="p-5">
        <Input placeholder="이메일을 입력하세요" />
      </Card>

      <Card className="p-5">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </Card>

      <Card>
        <EmptyState
          icon={<FileText size={20} />}
          title="아직 올라온 논문이 없어요"
          description="첫 PDF를 올려볼까요?"
          action={<Button>업로드</Button>}
        />
      </Card>
    </main>
  );
}
