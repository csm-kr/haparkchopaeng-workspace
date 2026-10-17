"use client";

import * as React from "react";
import { useLocalAgent } from "./provider";

/** 설치 앱의 첫 실행이 연 고정 경로. query 자체가 권한이나 성공의 증거는 아니다. */
export function LocalAgentClientResume() {
  const agent = useLocalAgent();
  const consumed = React.useRef(false);
  React.useEffect(() => {
    if (!agent || consumed.current || agent.phase === "loading") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("localAgentResume") !== "1") return;
    consumed.current = true;
    url.searchParams.delete("localAgentResume");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    agent.resumeFromInstall();
  }, [agent]);
  return null;
}
