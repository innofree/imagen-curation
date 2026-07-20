import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
export const dynamic = "force-dynamic";

// Per-GPU stats via nvidia-smi (ai-toolkit GPU widget과 동일 개념).
export async function GET() {
  const query =
    "index,name,temperature.gpu,utilization.gpu,memory.total,memory.free,memory.used,power.draw";
  try {
    const { stdout } = await execAsync(
      `nvidia-smi --query-gpu=${query} --format=csv,noheader,nounits`,
      { timeout: 8000 }
    );
    const gpus = stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const c = line.split(",").map((x) => x.trim());
        const num = (v: string) => (v === "" || v === "[N/A]" ? 0 : Number(v));
        return {
          index: num(c[0]),
          name: c[1] || `GPU ${c[0]}`,
          temperature: num(c[2]),
          util: num(c[3]),
          memTotal: num(c[4]),
          memFree: num(c[5]),
          memUsed: num(c[6]),
          power: num(c[7]),
          // idle-but-occupied = memory held with ~0% utilization (reclaim target)
          idleOccupied: num(c[3]) <= 8 && num(c[6]) > 1500,
        };
      });
    return NextResponse.json({ hasNvidiaSmi: true, gpus });
  } catch (e: any) {
    return NextResponse.json({ hasNvidiaSmi: false, gpus: [], error: String(e?.message ?? e) });
  }
}
