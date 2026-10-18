"use client";

import { useLocalAgent } from "./provider";
import { providerName, providerStatus, quotaWindows } from "./presentation";
import { QuotaBadge } from "./quota-badge";

export function LocalAgentProviderList() {
  const agent = useLocalAgent();
  if (!agent?.device) return null;
  return <ul aria-label="이 PC의 AI" className="divide-y divide-border-token">
    {agent.device.providers.map((provider) => <li key={provider.provider} className="flex min-w-0 items-center justify-between gap-2 py-2">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[13px] font-medium text-fg">{providerName[provider.provider]}</span>
        <span className="text-[12px] text-fg-muted">{providerStatus[provider.status]}</span>
        {provider.status === "login_required" && <span className="text-[11px] text-fg-muted">AI 브릿지에서 공식 로그인 안내를 확인해 주세요.</span>}
        {provider.status === "not_installed" && <span className="text-[11px] text-fg-muted">AI 브릿지에서 CLI 설치 안내를 확인해 주세요.</span>}
      </div>
      {agent.phase === "connected" && <QuotaBadge windows={quotaWindows(provider)} />}
    </li>)}
    {agent.device.providers.length === 0 && <li className="py-2 text-[12px] text-fg-muted">이 PC의 CLI를 확인하고 있어요.</li>}
  </ul>;
}
