import { Topbar } from "@/components/shell";
import { Skeleton } from "@/components/ui";

export default function Loading() {
  return <><Topbar crumbs={[{ label: "AI 채팅" }]} /><div role="status" aria-label="AI 채팅 불러오는 중" className="flex min-h-0 flex-1 flex-col gap-4 p-5"><Skeleton className="h-6 w-36" /><Skeleton className="h-24 w-full max-w-3xl" /><Skeleton className="mt-auto h-32 w-full max-w-3xl" /></div></>;
}
