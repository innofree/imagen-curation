import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { LOG_DIR } from "@/lib/paths";

export const dynamic = "force-dynamic";

// Tail the worker's per-job pipeline log (written by cron/startJob.ts to
// <IMAGEN_ROOT>/logs/curate-<jobID>.log). Returns the last MAX bytes so the UI
// can show live progress without streaming a multi-MB file.
const MAX = 64 * 1024;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ jobID: string }> }) {
  const { jobID } = await params;
  // jobIDs are 16-char hex; reject anything else to prevent path traversal.
  if (!/^[a-zA-Z0-9_-]+$/.test(jobID)) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }
  const p = path.join(LOG_DIR, `curate-${jobID}.log`);
  if (!fs.existsSync(p)) return NextResponse.json({ log: "", exists: false });

  const { size } = fs.statSync(p);
  const start = Math.max(0, size - MAX);
  const len = size - start;
  const buf = Buffer.alloc(len);
  const fd = fs.openSync(p, "r");
  try {
    fs.readSync(fd, buf, 0, len, start);
  } finally {
    fs.closeSync(fd);
  }
  let log = buf.toString("utf8");
  if (start > 0) log = "…(앞부분 생략)…\n" + log;
  return NextResponse.json({ log, exists: true, size, truncated: start > 0 });
}
