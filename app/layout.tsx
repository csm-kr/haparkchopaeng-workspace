import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "하박조팽",
  description: "4인 리서치 그룹의 주간 세미나 워크스페이스",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" data-theme="light">
      <body>{children}</body>
    </html>
  );
}
