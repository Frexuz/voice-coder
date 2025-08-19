import { NextResponse } from "next/server";

// Avoid caching in dev and ensure fresh proxying
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const { id, text } = body || {};
    if (!text) {
      return NextResponse.json({ error: "missing text" }, { status: 400 });
    }

    const base = process.env.BACKEND_HTTP_URL || "http://localhost:4000";
    const res = await fetch(`${base}/api/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, text }),
    });

    // Try to parse JSON from backend; if it fails, pass through text
    const contentType = res.headers.get("content-type") || "";
    let data: any;
    if (contentType.includes("application/json")) {
      data = await res.json().catch(() => ({ error: "invalid backend json" }));
    } else {
      data = { text: await res.text() };
    }

    return NextResponse.json(data, { status: res.ok ? 200 : res.status });
  } catch (err: any) {
    return NextResponse.json(
      { error: "proxy_failed", message: err?.message || "unknown error" },
      { status: 502 }
    );
  }
}
