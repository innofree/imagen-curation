import { PrismaClient } from "@prisma/client";
import { startJob, markRunning } from "./startJob";

// Background scheduler. The DB doubles as the queue (ai-toolkit pattern):
// one job runs at a time (GPU is the scarce resource); we poll every second.
const prisma = new PrismaClient();
const POLL_MS = 1000;
const ACTIVE = ["running", "analyzing", "applying"];

function pidAlive(pid?: number | null): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function tick() {
  // 1. reconcile: a job marked active whose process died -> error
  const active = await prisma.job.findMany({ where: { status: { in: ACTIVE } } });
  for (const j of active) {
    if (!pidAlive(j.pid)) {
      // grace: a just-spawned job may not have written a pid yet
      const ageMs = Date.now() - new Date(j.updated_at || 0).getTime();
      if (j.pid || ageMs > 15000) {
        await prisma.job.update({
          where: { id: j.id },
          data: { status: "error", info: "process exited unexpectedly" },
        });
      }
    }
  }

  // 2. if something is genuinely active, wait
  const stillActive = await prisma.job.findFirst({
    where: { status: { in: ACTIVE } },
  });
  if (stillActive) return;

  // 3. pick the next queued job (fresh analyze/auto, or a user-requested apply)
  const next = await prisma.job.findFirst({
    where: { status: { in: ["queued", "apply_queued"] } },
    orderBy: { created_at: "asc" },
  });
  if (!next) return;

  const mode =
    next.status === "apply_queued"
      ? "apply"
      : next.mode === "review"
      ? "analyze"
      : "auto";
  try {
    console.log(`[worker] starting job ${next.id} mode=${mode}`);
    await prisma.job.update({
      where: { id: next.id },
      data: { status: "running", info: `launching (${mode})`, stop: 0 },
    });
    const pid = startJob(next, mode as any);
    await markRunning(prisma, next.id, pid);
  } catch (e: any) {
    console.error("[worker] failed to start job", e);
    await prisma.job.update({
      where: { id: next.id },
      data: { status: "error", info: String(e?.message ?? e) },
    });
  }
}

async function main() {
  console.log("[worker] curation worker started");
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await tick();
    } catch (e) {
      console.error("[worker] tick error", e);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main();
