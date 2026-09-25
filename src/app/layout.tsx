import type { Metadata } from "next";
import Nav from "@/components/Nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Route Lab · 고려대 세종 → 조치원역",
  description: "다익스트라, A*, 양방향 다익스트라, 탐욕 탐색, 벨만-포드로 차도와 인도 경로를 비교하고 TMAP·카카오 길찾기와 견주어 보는 시각화",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <Nav />
        <main className="w-full max-w-6xl mx-auto px-4 sm:px-6 py-6 flex-1">{children}</main>
        <footer className="w-full max-w-6xl mx-auto px-4 sm:px-6 py-6 text-xs faint">
          지도 데이터 © OpenStreetMap contributors (ODbL) · DCCS309 C-1
        </footer>
      </body>
    </html>
  );
}
