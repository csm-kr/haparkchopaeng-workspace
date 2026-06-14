"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Calendar, Play, Sparkles, Video } from "lucide-react";
import { Avatar, Button, Input } from "@/components/ui";

// 로그인 / 히어로 화면 (SCREENS §auth). 스플릿 레이아웃.
// 합류는 초대 전용(ADR-007/R18) — 공개 가입 폼 없음. 운영 로그인은 Google OAuth,
// 로컬/데모는 시드 멤버 이메일로 빠른 로그인(POST /api/auth/login).

export interface QuickMember {
  id: string;
  name: string;
  initial: string;
  color: string;
  email: string;
  role: string;
}

const FEATURES = [
  { Icon: Video, title: "세미나 라이브", desc: "매주 토요일, 화상으로 모여 발표하고 함께 봐요" },
  { Icon: Sparkles, title: "논문 분석 관리", desc: "PDF를 올리면 연구·재구현 관점으로 구조화 분석" },
  { Icon: Play, title: "자료 관리", desc: "발표 자료를 쌓고 댓글로 회고를 남겨요" },
  { Icon: Calendar, title: "스케쥴 관리", desc: "발표 순번·로테이션·참여 현황을 한눈에" },
];

export function AuthScreen({
  members,
  allowDevLogin = false,
  authError = null,
}: {
  members: QuickMember[];
  allowDevLogin?: boolean;
  authError?: string | null;
}) {
  const router = useRouter();
  const [email, setEmail] = React.useState("");
  const [loading, setLoading] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function loginWithEmail(value: string, key: string) {
    setError(null);
    setLoading(key);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: value }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        setError(body?.error?.message ?? "로그인할 수 없어요.");
        setLoading(null);
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("잠시 후 다시 시도해주세요.");
      setLoading(null);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* 좌측 브랜드 패널 */}
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-bg-subtle p-12 lg:flex">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 size-96 rounded-full bg-accent-soft opacity-60 blur-3xl"
        />
        <div className="relative z-10">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-md bg-accent text-[15px] font-bold text-accent-fg">
              모모
            </div>
            <div>
              <div className="text-[17px] font-bold tracking-[-0.02em]">모두의모임</div>
              <div className="mt-0.5 text-xs text-fg-muted">research workspace</div>
            </div>
          </div>

          <h1 className="mt-12 text-[34px] font-bold leading-[1.2] tracking-[-0.03em]">
            리서치는
            <br />
            혼자 하는 게 아니야.
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-fg-muted">
            매주 모여 발표하고, 논문은 올리면 분석되고,
            <br />
            자료와 일정이 한 자리에 쌓이는 곳.
          </p>

          <ul className="mt-10 flex flex-col gap-5">
            {FEATURES.map(({ Icon, title, desc }) => (
              <li key={title} className="flex items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-bg-elevated text-accent">
                  <Icon size={18} />
                </span>
                <div>
                  <div className="text-sm font-semibold">{title}</div>
                  <div className="mt-0.5 text-xs text-fg-muted">{desc}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative z-10 text-xs text-fg-faint">© 2026 모두의모임</div>
      </aside>

      {/* 우측 로그인 폼 */}
      <main className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm">
          <h2 className="text-2xl font-bold tracking-[-0.02em]">다시 오셨네요</h2>
          <p className="mt-1.5 text-sm text-fg-muted">
            소셜 계정으로 간편하게 로그인하세요.
          </p>

          {authError === "google" && (
            <p
              role="alert"
              className="mt-4 rounded-sm border border-border bg-bg-subtle px-3 py-2.5 text-xs leading-relaxed text-fg-muted"
            >
              Google 로그인이 아직 준비 중이에요. 관리자가 설정을 마치면 켜져요.
            </p>
          )}

          <a
            href="/api/auth/google"
            className="mt-7 flex w-full items-center justify-center gap-2 rounded-sm border border-border-strong bg-bg-elevated px-3.5 py-2.5 text-sm font-medium text-fg transition-colors hover:bg-bg-subtle"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
            </svg>
            Google로 로그인
          </a>

          {allowDevLogin && (
            <>
          <div className="my-6 flex items-center gap-3 text-xs text-fg-faint">
            <span className="h-px flex-1 bg-border" />
            또는 이메일로
            <span className="h-px flex-1 bg-border" />
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (email.trim()) void loginWithEmail(email.trim(), "form");
            }}
            className="flex flex-col gap-2"
          >
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="이메일을 입력하세요"
              aria-label="이메일"
            />
            <Button
              type="submit"
              disabled={!email.trim() || loading !== null}
              className="w-full"
            >
              {loading === "form" ? "로그인 중…" : "로그인"}
            </Button>
          </form>

          {error && (
            <p role="alert" className="mt-3 text-xs text-busy">
              {error}
            </p>
          )}

          {members.length > 0 && (
            <div className="mt-8">
              <div className="mb-2.5 text-xs font-medium text-fg-subtle">
                빠른 로그인 (데모)
              </div>
              <div className="flex flex-col gap-1.5">
                {members.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    disabled={loading !== null}
                    onClick={() => void loginWithEmail(m.email, m.id)}
                    className="flex items-center gap-3 rounded-sm border border-border px-3 py-2 text-left transition-colors hover:bg-bg-subtle disabled:opacity-50"
                  >
                    <Avatar user={{ name: m.name, initial: m.initial, color: m.color }} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{m.name}</div>
                      <div className="truncate text-xs text-fg-muted">{m.email}</div>
                    </div>
                    <span className="text-xs text-fg-faint">{m.role}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
            </>
          )}

          <p className="mt-8 text-center text-xs leading-relaxed text-fg-faint">
            합류는 초대받은 계정만 가능해요. 공개 가입은 없어요.
          </p>
        </div>
      </main>
    </div>
  );
}
