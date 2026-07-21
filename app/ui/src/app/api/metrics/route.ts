import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import { prisma } from "@/lib/prisma";

const execAsync = promisify(exec);
export const dynamic = "force-dynamic";

// Prometheus text-format exposition of curation status + GPU telemetry.
// Scrape at GET /api/metrics. Kept dependency-free (hand-rolled formatting).
// Escape a label value per the Prometheus exposition format: backslash, double
// quote, and newline. (GPU name / job status are effectively trusted, but a
// stray backslash/newline would otherwise emit output a scraper rejects.)
const esc = (v: string) => String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
function line(name: string, value: number, labels?: Record<string, string>) {
  const l = labels
    ? "{" + Object.entries(labels).map(([k, v]) => `${k}="${esc(v)}"`).join(",") + "}"
    : "";
  return `${name}${l} ${value}`;
}

export async function GET() {
  const out: string[] = [];

  out.push("# HELP curation_up 1 if the curation UI is serving.");
  out.push("# TYPE curation_up gauge");
  out.push(line("curation_up", 1));

  // --- job counts by status --------------------------------------------
  try {
    const rows = await prisma.job.groupBy({ by: ["status"], _count: { _all: true } });
    out.push("# HELP curation_jobs Job count by status.");
    out.push("# TYPE curation_jobs gauge");
    for (const r of rows) out.push(line("curation_jobs", (r._count as any)._all, { status: r.status }));
    const total = rows.reduce((s, r) => s + (r._count as any)._all, 0);
    out.push("# HELP curation_jobs_total Total jobs.");
    out.push("# TYPE curation_jobs_total gauge");
    out.push(line("curation_jobs_total", total));
  } catch {
    out.push(line("curation_db_up", 0));
  }

  // --- GPU telemetry via nvidia-smi ------------------------------------
  const q = "index,name,temperature.gpu,utilization.gpu,memory.total,memory.used,power.draw";
  try {
    const { stdout } = await execAsync(
      `nvidia-smi --query-gpu=${q} --format=csv,noheader,nounits`,
      { timeout: 8000 }
    );
    const defs: [string, string][] = [
      ["curation_gpu_utilization_percent", "GPU utilization percent."],
      ["curation_gpu_memory_total_bytes", "GPU memory total (bytes)."],
      ["curation_gpu_memory_used_bytes", "GPU memory used (bytes)."],
      ["curation_gpu_temperature_celsius", "GPU temperature (C)."],
      ["curation_gpu_power_watts", "GPU power draw (W)."],
    ];
    for (const [name, help] of defs) {
      out.push(`# HELP ${name} ${help}`);
      out.push(`# TYPE ${name} gauge`);
    }
    for (const raw of stdout.trim().split("\n").filter(Boolean)) {
      const c = raw.split(",").map((x) => x.trim());
      const num = (v: string) => (v === "" || v === "[N/A]" ? 0 : Number(v));
      const labels = { gpu: c[0], name: c[1] || `gpu${c[0]}` };
      const mib = 1024 * 1024;
      // CSV column order: index,name,temp,util,memory.total,memory.used,power
      out.push(line("curation_gpu_utilization_percent", num(c[3]), labels));
      out.push(line("curation_gpu_memory_total_bytes", num(c[4]) * mib, labels));
      out.push(line("curation_gpu_memory_used_bytes", num(c[5]) * mib, labels));
      out.push(line("curation_gpu_temperature_celsius", num(c[2]), labels));
      out.push(line("curation_gpu_power_watts", num(c[6]), labels));
    }
    out.push(line("curation_nvidia_smi_up", 1));
  } catch {
    out.push(line("curation_nvidia_smi_up", 0));
  }

  return new NextResponse(out.join("\n") + "\n", {
    headers: { "Content-Type": "text/plain; version=0.0.4; charset=utf-8", "Cache-Control": "no-store" },
  });
}
