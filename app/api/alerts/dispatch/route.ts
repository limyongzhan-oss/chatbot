import { NextResponse, type NextRequest } from "next/server";
import { dispatch } from "@/lib/alerts/outbox";

// Retries pending/failed alerts. Call from a scheduler every few minutes:
//   curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/alerts/dispatch
// (Vercel Cron sends GET with the same header.)
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await dispatch());
}

export const GET = handle;
export const POST = handle;
export const dynamic = "force-dynamic";
