import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import { PrismaClient } from "@prisma/client";
import {
  PACKAGE_DIR, HF_HOME, DB_PATH, LOG_DIR, DEFAULT_MODEL, HF_TOKEN, resolvePython,
} from "../src/lib/paths";

/**
 * Spawn the Python curation pipeline for a job, fully detached (survives
 * worker/UI restarts). Mirrors ai-toolkit's startJob.ts pattern: progress and
 * results flow back through the shared SQLite DB, which the UI polls.
 *
 * mode: "analyze" for a review-gated job (stops at status 'review'/'analyzed');
 *       "auto" to analyze then apply in one run.
 */
export function startJob(job: any, mode: "analyze" | "auto" | "apply") {
  const py = resolvePython();
  const script = "curation.curate";
  const args = [
    "-u", "-m", script,
    "--job-id", job.id,
    "--db", DB_PATH,
    "--src", job.source_folder,
    "--mode", mode,
  ];
  if (job.target) args.push("--target", String(job.target));
  if (job.recaption) args.push("--recaption");
  if (job.do_delete) args.push("--delete");
  if (job.dry_run) args.push("--dry-run");
  // GPU/quantize policy: by default the pipeline reclaims an idle-but-occupied
  // GPU (stops idle ComfyUI) and runs bf16; only quantizes if VRAM stays tight.
  let p: any = {};
  try { p = job.params ? JSON.parse(job.params) : {}; } catch { p = {}; }
  if (p.quantize === true) args.push("--quantize", "--low-vram");
  else if (p.quantize === false) args.push("--no-quantize");
  if (p.auto_free_gpu === false) args.push("--no-free-gpu");
  // Per-job model pin (New Curation) or the configured default model.
  args.push("--model", p.model_name_or_path || DEFAULT_MODEL);
  // Training purpose (face/full_body/pose/outfit/style). Always passed
  // explicitly so the worker log's argv is self-documenting; falls back to
  // "face" (identity LoRA) for older jobs with no purpose in params.
  args.push("--purpose", p.purpose || "face");

  fs.mkdirSync(LOG_DIR, { recursive: true });
  const logPath = path.join(LOG_DIR, `curate-${job.id}.log`);
  const out = fs.openSync(logPath, "a");

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HF_HOME,
    HF_HUB_ENABLE_HF_TRANSFER: "1",
    // Optional token for gated/rate-limited HF pulls (huggingface_hub reads it).
    ...(HF_TOKEN ? { HF_TOKEN } : {}),
    // `curation` package lives under app/ (PACKAGE_DIR), not the imagen-lab root.
    PYTHONPATH: PACKAGE_DIR,
    CUDA_DEVICE_ORDER: "PCI_BUS_ID",
    CUDA_VISIBLE_DEVICES: String(job.gpu_ids ?? "0"),
    // curate.py uses --device cuda:0 which maps to the visible device above.
    CURATION_JOB: job.id,
    // Marker so the imagen-lab `watch` daemon treats this as a GPU claimant
    // (stops/restores ComfyUI on the target GPU just like a training job).
    IS_CURATION_JOB: "1",
  };
  // The job passed cuda:0; ensure device flag matches the visible remap.
  args.push("--device", "cuda:0");

  const child = spawn(py, args, {
    detached: true,
    stdio: ["ignore", out, out],
    env,
    cwd: PACKAGE_DIR,
  });
  const pid = child.pid;
  child.unref();
  return pid;
}

export async function markRunning(prisma: PrismaClient, id: string, pid?: number) {
  await prisma.job.update({
    where: { id },
    data: { status: "running", pid: pid ?? null, updated_at: new Date().toISOString() },
  });
}
