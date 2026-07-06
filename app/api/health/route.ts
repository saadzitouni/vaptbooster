import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// Liveness + readiness: 200 when the app can reach the DB, 503 otherwise.
// Public (no auth) — used by the container/reverse-proxy health checks.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.$queryRawUnsafe("SELECT 1");
    return NextResponse.json({ status: "ok", db: "up" });
  } catch {
    return NextResponse.json({ status: "degraded", db: "down" }, { status: 503 });
  }
}
