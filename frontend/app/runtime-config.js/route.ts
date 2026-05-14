import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function scriptValue(value: string) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function GET() {
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";
  const body = `window.__LYNK_RUNTIME_CONFIG__={apiBaseUrl:${scriptValue(apiBaseUrl)}};`;

  return new NextResponse(body, {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      "Content-Type": "application/javascript; charset=utf-8",
    },
  });
}
