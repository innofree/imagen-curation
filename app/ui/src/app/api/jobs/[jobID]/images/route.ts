import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET: all image results for a job (parsed vl/quality_reasons).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ jobID: string }> }) {
  const { jobID } = await params;
  const rows = await prisma.imageResult.findMany({
    where: { job_ref: jobID },
    orderBy: [{ bucket: "asc" }, { filename: "asc" }],
  });
  const images = rows.map((r) => ({
    ...r,
    vl: safeParse(r.vl, {}),
    quality_reasons: safeParse(r.quality_reasons, []),
    decision: r.user_decision ?? r.auto_decision,
  }));
  return NextResponse.json({ images });
}

// PATCH: set a user override decision. Body: { id, decision: 'keep'|'reject'|null }
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ jobID: string }> }) {
  const { jobID } = await params;
  const body = await req.json();
  const { id, decision } = body;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  // Scope the update to this job so a stale/crafted request cannot change
  // another job's review decision (updateMany allows the composite filter).
  const res = await prisma.imageResult.updateMany({
    where: { id, job_ref: jobID },
    data: { user_decision: decision === "keep" || decision === "reject" ? decision : null },
  });
  if (res.count === 0) return NextResponse.json({ error: "not found for job" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

function safeParse(s: string, fallback: any) {
  try { return JSON.parse(s); } catch { return fallback; }
}
