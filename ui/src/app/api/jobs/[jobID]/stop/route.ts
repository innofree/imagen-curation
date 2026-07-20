import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ jobID: string }> }) {
  const { jobID } = await params;
  await prisma.job.update({
    where: { id: jobID },
    data: { stop: 1, info: "stop requested", updated_at: new Date().toISOString() },
  });
  return NextResponse.json({ ok: true });
}
