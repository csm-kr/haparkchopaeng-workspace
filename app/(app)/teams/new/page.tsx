import { Card } from "@/components/ui";
import { CreateTeamForm } from "./create-team-form";

// 팀 없음 착지 화면(ADR-018). 멤버십 없는 사용자가 (app)/layout 가드로 여기로 온다.
// 진입 경로는 둘뿐: 팀 만들기 · 초대 토큰 수락(R18). 공개 가입(자동 팀 배정) 없음.

export default function NewTeamPage() {
  return (
    <div className="flex flex-1 items-center justify-center overflow-y-auto p-6">
      <Card className="flex w-full max-w-md flex-col gap-5 p-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-[22px] font-bold tracking-[-0.02em] text-fg">팀 만들기</h1>
          <p className="text-[13px] text-fg-muted">
            새 팀을 만들어 시작하거나, 받은 초대 링크로 합류하세요.
          </p>
        </div>

        <CreateTeamForm />

        <div className="border-t border-border-token pt-4 text-[13px] text-fg-subtle">
          초대 링크를 받았다면 그 주소로 들어가면 합류할 수 있어요.
        </div>
      </Card>
    </div>
  );
}
