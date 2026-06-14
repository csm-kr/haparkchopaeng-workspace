"use client";

import * as React from "react";
import { Check, Moon, Sun } from "lucide-react";
import { Avatar, Badge, Button, Card, Input } from "@/components/ui";
import { useTheme, type Theme } from "@/components/providers";
import { cn } from "@/lib/utils";
import { LegalModal, type LegalDoc } from "./legal-modal";
import type { ProfileView } from "./types";
import type { Role } from "@/types";

// 설정 — 인터랙티브 섬(ADR-015). 프로필·알림·테마·법적 링크.
// CRITICAL: 프로필 저장은 기존 PATCH /api/me를 호출한다 — 새 엔드포인트를 만들지 않는다.
//   대상은 서버가 세션에서 취한다(R3) — 여기서 id를 보내지 않는다.
// CRITICAL: 테마는 ThemeProvider로 <html data-theme>만 바꾼다 — 컴포넌트 분기 없음(R20).
// 알림은 인앱 기본(채널 미결 I-5). 외부 채널(이메일/푸시)은 만들지 않는다 — 토글 UI는 로컬 저장.

const ROLE_VARIANT: Record<Role, "admin" | "member" | "guest"> = {
  관리자: "admin",
  멤버: "member",
  게스트: "guest",
};

const THEMES: { value: Theme; label: string; icon: React.ReactNode }[] = [
  { value: "light", label: "라이트", icon: <Sun size={15} aria-hidden="true" /> },
  { value: "dark", label: "다크", icon: <Moon size={15} aria-hidden="true" /> },
];

// 인앱 알림 토글 — 채널은 미결(I-5)이라 로컬에 저장만 한다(서버 발송 없음).
const NOTIF_KEY = "hapark_notif";
const NOTIF_OPTIONS = [
  { id: "live", label: "라이브 시작 알림", desc: "세미나 라이브가 시작되면 인앱으로 알려요." },
  { id: "mention", label: "@멘션 알림", desc: "댓글에서 나를 언급하면 인앱으로 알려요." },
] as const;
type NotifId = (typeof NOTIF_OPTIONS)[number]["id"];
type NotifState = Record<NotifId, boolean>;

const DEFAULT_NOTIF: NotifState = { live: true, mention: true };

function loadNotif(): NotifState {
  try {
    const raw = window.localStorage.getItem(NOTIF_KEY);
    if (!raw) return DEFAULT_NOTIF;
    const parsed = JSON.parse(raw) as Partial<NotifState>;
    return {
      live: parsed.live ?? DEFAULT_NOTIF.live,
      mention: parsed.mention ?? DEFAULT_NOTIF.mention,
    };
  } catch {
    return DEFAULT_NOTIF;
  }
}

interface ApiShape<T> {
  data?: T;
  error?: { code: string; message: string };
}

export function SettingsView({ profile }: { profile: ProfileView }) {
  const { theme, setTheme } = useTheme();

  // 프로필 폼 — 마운트 후 로컬 상태가 진실.
  const [name, setName] = React.useState(profile.name);
  const [handle, setHandle] = React.useState(profile.handle);
  const [status, setStatus] = React.useState(profile.status ?? "");
  const [fieldError, setFieldError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);

  // 알림 토글 — 인앱 전용, 로컬 저장.
  const [notif, setNotif] = React.useState<NotifState>(DEFAULT_NOTIF);
  React.useEffect(() => {
    setNotif(loadNotif());
  }, []);

  // 법적 문서 시트
  const [legal, setLegal] = React.useState<LegalDoc | null>(null);

  // 로그아웃 진행 상태
  const [loggingOut, setLoggingOut] = React.useState(false);

  async function logout() {
    setLoggingOut(true);
    // 성공/실패와 무관하게 로그인 화면으로 — 전체 네비게이션으로 서버가 세션 없이 다시 렌더.
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // 네트워크 실패여도 어차피 로그인 화면으로 보낸다.
    } finally {
      window.location.assign("/");
    }
  }

  function toggleNotif(id: NotifId) {
    setNotif((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        window.localStorage.setItem(NOTIF_KEY, JSON.stringify(next));
      } catch {
        // 저장 실패는 무시(프라이빗 모드 등) — UI 동작에는 영향 없음.
      }
      return next;
    });
  }

  async function saveProfile() {
    const trimmedName = name.trim();
    const trimmedHandle = handle.trim();
    // 검증은 인라인 — 토스트가 아니라 입력 옆 안내(R30).
    if (!trimmedName) {
      setFieldError("이름을 입력해주세요.");
      return;
    }
    if (!trimmedHandle) {
      setFieldError("핸들을 입력해주세요.");
      return;
    }
    setSaving(true);
    setFieldError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // id는 보내지 않는다 — 서버가 세션에서 취한다(R3).
        body: JSON.stringify({
          name: trimmedName,
          handle: trimmedHandle,
          status: trimmedStatusOrNull(status),
        }),
      });
      const json: ApiShape<unknown> = await res.json().catch(() => ({}));
      if (!res.ok || !json.data) {
        setFieldError(json.error?.message ?? "저장하지 못했어요. 잠깐 후 다시 시도해주세요.");
        return;
      }
      setSaved(true);
    } catch {
      setFieldError("저장하지 못했어요. 잠깐 후 다시 시도해주세요.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-[28px] leading-tight font-bold tracking-[-0.025em] text-fg">
          설정
        </h1>
        <p className="text-[13px] text-fg-muted">
          프로필과 알림, 테마를 여기서 바꿀 수 있어요.
        </p>
      </div>

      {/* 프로필 */}
      <Card className="flex flex-col gap-4 p-5">
        <h2 className="text-[20px] font-semibold text-fg">프로필</h2>
        <div className="flex items-center gap-3">
          <Avatar
            user={{ name: profile.name, initial: profile.initial, color: profile.color }}
            size="xl"
          />
          <div className="flex flex-col gap-1">
            <span className="text-[14px] font-medium text-fg">{profile.email}</span>
            <Badge variant={ROLE_VARIANT[profile.role]}>{profile.role}</Badge>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-fg-muted">이름</span>
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setSaved(false);
              }}
              aria-label="이름"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-fg-muted">핸들</span>
            <Input
              value={handle}
              onChange={(e) => {
                setHandle(e.target.value);
                setSaved(false);
              }}
              aria-label="핸들"
              placeholder="@handle"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-fg-muted">상태 메시지</span>
            <Input
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setSaved(false);
              }}
              aria-label="상태 메시지"
              placeholder="지금 무엇을 하고 있나요? (선택)"
            />
          </label>

          {/* 읽기 전용 — 이메일·역할은 여기서 바꾸지 않는다(역할 변경은 팀 관리). */}
          <div className="flex flex-col gap-2 rounded-md bg-bg-subtle px-3 py-2.5">
            <div className="flex items-center justify-between text-[13px]">
              <span className="text-fg-subtle">이메일</span>
              <span className="text-fg-muted">{profile.email}</span>
            </div>
            <div className="flex items-center justify-between text-[13px]">
              <span className="text-fg-subtle">역할</span>
              <span className="text-fg-muted">{profile.role}</span>
            </div>
          </div>

          {fieldError && (
            <p role="alert" className="text-[12px] text-busy">
              {fieldError}
            </p>
          )}

          <div className="flex items-center gap-3">
            <Button onClick={saveProfile} disabled={saving}>
              {saving ? "저장 중…" : "저장"}
            </Button>
            {saved && (
              <span
                role="status"
                className="inline-flex items-center gap-1 text-[13px] text-online"
              >
                <Check size={14} aria-hidden="true" /> 저장했어요
              </span>
            )}
          </div>
        </div>
      </Card>

      {/* 알림 — 인앱 기본(채널 미결 I-5). 외부 채널은 없다. */}
      <Card className="flex flex-col gap-3 p-5">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-[20px] font-semibold text-fg">알림</h2>
          <p className="text-[12px] text-fg-subtle">앱 안에서 받는 알림이에요.</p>
        </div>
        <ul className="flex flex-col divide-y divide-border-token">
          {NOTIF_OPTIONS.map((opt) => {
            const on = notif[opt.id];
            return (
              <li
                key={opt.id}
                className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="flex flex-col">
                  <span className="text-[14px] font-medium text-fg">{opt.label}</span>
                  <span className="text-[12px] text-fg-subtle">{opt.desc}</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-label={opt.label}
                  onClick={() => toggleNotif(opt.id)}
                  className={cn(
                    "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
                    "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-soft",
                    on ? "bg-accent" : "bg-bg-hover",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "inline-block size-4 rounded-full bg-bg-elevated transition-transform",
                      on ? "translate-x-6" : "translate-x-1",
                    )}
                  />
                </button>
              </li>
            );
          })}
        </ul>
      </Card>

      {/* 테마 — [data-theme] 토큰 오버라이드만(R20). */}
      <Card className="flex flex-col gap-3 p-5">
        <h2 className="text-[20px] font-semibold text-fg">테마</h2>
        <div role="group" aria-label="테마 선택" className="flex gap-2">
          {THEMES.map((t) => {
            const active = theme === t.value;
            return (
              <button
                key={t.value}
                type="button"
                aria-pressed={active}
                onClick={() => setTheme(t.value)}
                className={cn(
                  "inline-flex flex-1 items-center justify-center gap-2 rounded-md border px-4 py-3 text-[13px] font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-soft",
                  active
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-border-strong text-fg-muted hover:bg-bg-hover hover:text-fg",
                )}
              >
                {t.icon}
                {t.label}
                {active && <Check size={14} aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      </Card>

      {/* 법적 링크 */}
      <Card className="flex flex-col gap-2 p-5">
        <h2 className="text-[20px] font-semibold text-fg">약관·정책</h2>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => setLegal("terms")}
            className="text-[13px] text-accent underline-offset-2 hover:underline"
          >
            이용약관
          </button>
          <button
            type="button"
            onClick={() => setLegal("privacy")}
            className="text-[13px] text-accent underline-offset-2 hover:underline"
          >
            개인정보처리방침
          </button>
        </div>
      </Card>

      {/* 계정 — 로그아웃은 기존 POST /api/auth/logout만 호출한다(새 엔드포인트 없음). */}
      <Card className="flex flex-col gap-3 p-5">
        <h2 className="text-[20px] font-semibold text-fg">계정</h2>
        <div>
          <Button variant="secondary" onClick={logout} disabled={loggingOut}>
            {loggingOut ? "로그아웃 중…" : "로그아웃"}
          </Button>
        </div>
      </Card>

      {legal && (
        <LegalModal doc={legal} onClose={() => setLegal(null)} onSwitch={setLegal} />
      )}
    </div>
  );
}

/** 공백뿐이면 null(상태 비움), 아니면 트림한 값. */
function trimmedStatusOrNull(value: string): string | null {
  const v = value.trim();
  return v.length > 0 ? v : null;
}
