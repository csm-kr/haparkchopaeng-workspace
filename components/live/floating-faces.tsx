"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { PictureInPicture2, X } from "lucide-react";

type PictureInPictureApi = {
  requestWindow: (options: { width: number; height: number }) => Promise<Window>;
};

function pictureInPictureApi() {
  return (window as Window & { documentPictureInPicture?: PictureInPictureApi })
    .documentPictureInPicture;
}

/** 다른 앱에서 발표해도 보이는 얼굴 창. 기존 룸의 영상만 표시하고 오디오는 복제하지 않는다. */
export function FloatingFaces({ children }: { children: React.ReactNode }) {
  const [supported, setSupported] = React.useState(false);
  const [pipWindow, setPipWindow] = React.useState<Window | null>(null);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const windowRef = React.useRef<Window | null>(null);
  const mounted = React.useRef(false);

  React.useEffect(() => {
    mounted.current = true;
    setSupported(typeof pictureInPictureApi()?.requestWindow === "function");
    return () => {
      mounted.current = false;
      windowRef.current?.close();
      windowRef.current = null;
    };
  }, []);

  React.useEffect(() => {
    if (!pipWindow) return;
    const onClose = () => {
      if (windowRef.current !== pipWindow) return;
      windowRef.current = null;
      if (mounted.current) setPipWindow(null);
    };
    // 별도 문서에도 현재 테마와 토큰을 적용한다.
    const syncTheme = () => {
      for (const attr of document.documentElement.attributes) {
        pipWindow.document.documentElement.setAttribute(attr.name, attr.value);
      }
      pipWindow.document.body.className = document.body.className;
    };
    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, { attributes: true });
    pipWindow.addEventListener("pagehide", onClose);
    return () => {
      observer.disconnect();
      pipWindow.removeEventListener("pagehide", onClose);
    };
  }, [pipWindow]);

  function close() {
    const current = windowRef.current;
    windowRef.current = null;
    setPipWindow(null);
    current?.close();
  }

  async function open() {
    const api = pictureInPictureApi();
    if (!api || pending) return;
    setError(null);
    setPending(true);
    let opened: Window | undefined;
    try {
      // 브라우저가 사용자 클릭을 요구하므로 공유 시작 후 이 버튼으로 연다.
      opened = await api.requestWindow({ width: 300, height: 560 });
      // 창을 여는 동안 공유가 끝나거나 룸을 나갔다면 뒤늦게 열린 창도 닫는다.
      if (!mounted.current || opened.closed) {
        opened.close();
        return;
      }
      opened.document.title = "참가자 얼굴 · 하박조팽";
      for (const node of document.querySelectorAll<HTMLStyleElement | HTMLLinkElement>(
        'style, link[rel="stylesheet"]',
      )) {
        const copy = node.cloneNode(true) as HTMLStyleElement | HTMLLinkElement;
        if (node instanceof HTMLLinkElement && copy instanceof HTMLLinkElement) {
          copy.href = node.href;
        }
        opened.document.head.appendChild(copy);
      }
      windowRef.current = opened;
      setPipWindow(opened);
    } catch {
      opened?.close();
      if (mounted.current) {
        setError("얼굴 창을 열지 못했어요. 다시 눌러주세요.");
      }
    } finally {
      if (mounted.current) setPending(false);
    }
  }

  return (
    <>
      <div className="flex flex-col gap-1">
        <button
          type="button"
          aria-label={pipWindow ? "얼굴 창 닫기" : "참가자 얼굴 띄우기"}
          aria-pressed={!!pipWindow}
          disabled={!supported || pending}
          onClick={pipWindow ? close : () => void open()}
          className="inline-flex min-h-8 items-center justify-center gap-1 rounded-sm border border-border-strong px-2 py-1 text-[11px] font-medium text-fg-muted hover:bg-bg-hover hover:text-fg disabled:opacity-50"
        >
          <PictureInPicture2 size={14} aria-hidden="true" />
          {pipWindow ? "얼굴 창 닫기" : pending ? "여는 중…" : "얼굴 띄우기"}
        </button>
        {!supported && (
          <p className="text-[11px] text-fg-subtle">
            얼굴 창은 데스크톱 Chrome·Edge에서 사용할 수 있어요.
          </p>
        )}
        {error && <p role="alert" className="text-[11px] text-busy">{error}</p>}
      </div>
      {pipWindow && createPortal(
        <section aria-label="참가자 얼굴" className="flex h-screen flex-col gap-2 bg-bg p-2 text-fg">
          <header className="flex shrink-0 items-center justify-between gap-2">
            <h2 className="text-[13px] font-semibold">참가자 얼굴</h2>
            <button
              type="button"
              aria-label="얼굴 창 닫기"
              onClick={close}
              className="grid size-8 place-items-center rounded-sm text-fg-muted hover:bg-bg-hover hover:text-fg"
            >
              <X size={15} aria-hidden="true" />
            </button>
          </header>
          <div className="grid min-h-0 flex-1 auto-rows-max content-start gap-2 overflow-y-auto">
            {children}
          </div>
        </section>,
        pipWindow.document.body,
      )}
    </>
  );
}
