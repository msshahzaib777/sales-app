import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import "./globals.css";

import { KeyboardShortcuts } from "@/components/layout/keyboard-shortcuts";
import { ListMemory } from "@/components/layout/record-pager";
import { APP_NAME, TAGLINE } from "@/lib/brand";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: APP_NAME,
    template: `%s · ${APP_NAME}`,
  },
  description: `${APP_NAME}: ${TAGLINE}.`,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full">
        {children}
        {/* Esc, Alt+N, Ctrl+Enter, type to find … on every page. In Suspense: it reads the URL,
            which is only known when the page is requested. */}
        <Suspense fallback={null}>
          <KeyboardShortcuts />
          <ListMemory />
        </Suspense>
      </body>
    </html>
  );
}
