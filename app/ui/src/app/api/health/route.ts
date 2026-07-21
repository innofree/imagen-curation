import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Lightweight liveness/readiness probe (no nvidia-smi). Verifies the process is
// up and the job DB is reachable. Used by docker-compose healthcheck and any
// external orchestrator. Returns 200 when healthy, 503 otherwise.
export async function GET() {
  const started = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({
      status: "ok",
      db: true,
      uptime_s: Math.round(process.uptime()),
      latency_ms: Date.now() - started,
    });
  } catch (e: any) {
    return NextResponse.json(
      { status: "error", db: false, error: String(e?.message ?? e) },
      { status: 503 }
    );
  }
}
