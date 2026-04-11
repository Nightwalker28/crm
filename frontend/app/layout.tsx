import type { Metadata } from "next";
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
        <link
          href="https://api.fontshare.com/v2/css?f[]=satoshi@1,2&display=swap"
          rel="stylesheet"
        ></link>
      </head>
      <body className="font-satoshi antialiased">
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