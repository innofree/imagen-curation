import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ jobID: string }> }) {
  const { jobID } = await params;
  const job = await prisma.job.findUnique({ where: { id: jobID } });
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });
  const counts = await prisma.imageResult.groupBy({
    by: ["auto_decision"],
    where: { job_ref: jobID },
    _count: true,
  });
  return NextResponse.json({ job, counts });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ jobID: string }> }) {
  const { jobID } = await params;
  await prisma.imageResult.deleteMany({ where: { job_ref: jobID } });
  await prisma.job.delete({ where: { id: jobID } });
  return NextResponse.json({ ok: true });
}
