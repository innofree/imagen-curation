import "./globals.css";
import type { Metadata } from "next";
import { Noto_Sans_KR } from "next/font/google";
import Sidebar from "@/components/Sidebar";
import FontApplier from "@/components/FontApplier";

// Google-hosted Korean+Latin web font, optimized & self-hosted by Next at
// build time (no runtime CDN request). Suitable for web UI.
const notoKR = Noto_Sans_KR({
  weight: ["400", "500", "700"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-noto",
  preload: false, // CJK font is large; avoid preloading every glyph chunk
});

export const metadata: Metadata = {
  title: "Curation Lab",
  description: "LoRA training dataset curation",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={`dark ${notoKR.variable}`}>
      <body>
        <FontApplier />
        <div className="flex min-h-screen">
          <Sidebar />
          <main className="flex-1 min-w-0">{children}</main>
        </div>
      </body>
    </html>
  );
}
