import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Queue the apply phase after review. Optional body overrides recaption/delete.
export async function POST(req: NextRequest, { params }: { params: Promise<{ jobID: string }> }) {
  const { jobID } = await params;
  const job = await prisma.job.findUnique({ where: { id: jobID } });
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!["review", "analyzed", "completed"].includes(job.status)) {
    return NextResponse.json(
      { error: `cannot apply from status '${job.status}'` },
      { status: 409 }
    );
  }
  let body: any = {};
  try { body = await req.json(); } catch {}
  await prisma.job.update({
    where: { id: jobID },
    data: {
      status: "apply_queued",
      stop: 0,
      dry_run: body.dry_run ? 1 : 0,
      recaption: body.recaption ?? job.recaption ? 1 : 0,
      do_delete: body.do_delete ?? job.do_delete ? 1 : 0,
      info: "apply queued",
      updated_at: new Date().toISOString(),
    },
  });
  return NextResponse.json({ ok: true });
}
