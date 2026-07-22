import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import path from "path";
import { prisma } from "@/lib/prisma";
import { DATASETS_DIR } from "@/lib/paths";
import { PURPOSE_VALUES } from "@/lib/purposes";

export const dynamic = "force-dynamic";

export async function GET() {
  const jobs = await prisma.job.findMany({ orderBy: { created_at: "desc" } });
  return NextResponse.json({ jobs });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const source = body.source_folder as string;
  if (!source) {
    return NextResponse.json({ error: "source_folder required" }, { status: 400 });
  }
  // purpose is a closed enum that drives materially different Python logic; a
  // typo reaching the worker is a hard-to-debug silent failure, so reject early.
  if (body.purpose && !PURPOSE_VALUES.has(body.purpose)) {
    return NextResponse.json({ error: `invalid purpose: ${body.purpose}` }, { status: 400 });
  }
  // Resolve a bare dataset name against datasets/, or accept an absolute path.
  const sourceFolder = path.isAbsolute(source)
    ? source
    : path.join(DATASETS_DIR, source);

  const id = randomUUID().replace(/-/g, "").slice(0, 16);
  const base = path.basename(sourceFolder);
  const now = new Date().toISOString();

  const params: any = {
    auto_free_gpu: body.auto_free_gpu !== false,
    model_name_or_path: body.model || undefined,
    purpose: body.purpose || undefined,
    quality: body.quality || undefined,
    dedup: body.dedup || undefined,
    coverage: body.coverage || undefined,
  };
  // VRAM mode: "auto" (reclaim idle GPU -> bf16, else fp8) | "bf16" | "fp8"
  if (body.vram_mode === "bf16") params.quantize = false;
  else if (body.vram_mode === "fp8") params.quantize = true;

  const job = await prisma.job.create({
    data: {
      id,
      name: `${base}-${id.slice(0, 6)}`,
      source_folder: sourceFolder,
      gpu_ids: String(body.gpu_ids ?? "0"),
      mode: body.mode === "review" ? "review" : "auto",
      params: JSON.stringify(params),
      status: "queued",
      dry_run: body.dry_run ? 1 : 0,
      recaption: body.recaption ? 1 : 0,
      do_delete: body.do_delete ? 1 : 0,
      target: body.target ? Number(body.target) : null,
      created_at: now,
      updated_at: now,
    },
  });
  return NextResponse.json({ job });
}
