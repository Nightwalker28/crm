import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";
import ClientLayout from "./ClientLayout";
import { Toaster } from "@/components/ui/sonner";
import Providers from "./providers";

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
    <html lang="en" className="dark" suppressHydrationWarning={true}>
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
