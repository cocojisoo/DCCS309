import type { Metadata } from "next";
import Nav from "@/components/Nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Route Lab · Korea Univ. Sejong → Jochiwon Station",
  description: "A visual comparison of DFS, Dijkstra, A*, CCH and LPA* on the real Jochiwon road network, in normal traffic and under congestion and closures",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <Nav />
        <main className="w-full max-w-6xl mx-auto px-4 sm:px-6 py-6 flex-1">{children}</main>
        <footer className="w-full max-w-6xl mx-auto px-4 sm:px-6 py-6 text-xs faint">
          Map data © OpenStreetMap contributors (ODbL) · DCCS309 C-1
        </footer>
      </body>
    </html>
  );
}
