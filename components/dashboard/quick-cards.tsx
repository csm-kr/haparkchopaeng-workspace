import Link from "next/link";
import { BookText, Play } from "lucide-react";
import { Card } from "@/components/ui";

// 홈 퀵 카드 행 — {icon, label, count, desc} (SCREENS §dashboard).
// 데이터는 RSC(page)에서 받아 props로 내려온다(ADR-015). 토큰만 사용(R20).

interface QuickCardItem {
  href: string;
  label: string;
  count: number;
  desc: string;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
}

export interface QuickCardsProps {
  paperCount: number;
  presentationCount: number;
}

export function QuickCards({ paperCount, presentationCount }: QuickCardsProps) {
  const items: QuickCardItem[] = [
    {
      href: "/library",
      label: "논문",
      count: paperCount,
      desc: "두 관점으로 함께 읽기",
      Icon: BookText,
    },
    {
      href: "/presentations",
      label: "발표 자료",
      count: presentationCount,
      desc: "회고가 쌓이는 곳",
      Icon: Play,
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {items.map((item) => (
        <Link key={item.href} href={item.href} aria-label={`${item.label} ${item.count}개`}>
          <Card hoverable className="flex items-center gap-4 p-4">
            <div
              aria-hidden="true"
              className="grid size-10 shrink-0 place-items-center rounded-md bg-accent-soft text-accent"
            >
              <item.Icon size={18} />
            </div>
            <div className="flex min-w-0 flex-col">
              <span className="font-mono text-[22px] font-semibold leading-none text-fg">
                {item.count}
              </span>
              <span className="mt-1 text-[13px] font-medium text-fg">
                {item.label}
              </span>
              <span className="truncate text-[12px] text-fg-subtle">
                {item.desc}
              </span>
            </div>
          </Card>
        </Link>
      ))}
    </div>
  );
}
