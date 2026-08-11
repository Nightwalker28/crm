import type { Metadata } from "next";
import Script from "next/script";
import { Inter } from "next/font/google";
import "./globals.css";
import ClientLayout from "./ClientLayout";
import { Toaster } from "@/components/ui/sonner";
import Providers from "./providers";

// The only webfont. Inter was named in the token file but never loaded, so every
// operator without it installed locally was reading system-ui. next/font
// self-hosts it into the build output: no CDN request, no layout shift.
//
// There is deliberately no mono webfont - machine strings use a system stack.
// See docs/design/design.md 3.2.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Lynk",
  description: "for Acumen Intelligence",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // No theme class here: next-themes stamps it before paint. :root already
    // carries the dark set, so a class-less server render still paints dark.
    <html lang="en" className={inter.variable} suppressHydrationWarning={true}>
      <head>
        <Script src="/runtime-config.js" strategy="beforeInteractive" />
      </head>
      <body className="font-sans antialiased">
        {/* Wrap everything inside the body with Providers */}
        <Providers>
          <ClientLayout>
            <Toaster />
            {children}
          </ClientLayout>
        </Providers>
      </body>
    </html>
  );
}
