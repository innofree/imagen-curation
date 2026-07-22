"use client";
import { useEffect, useState } from "react";
import { Thermometer, Zap, Cpu } from "lucide-react";
import { useLocale } from "@/components/LocaleProvider";

interface Gpu {
  index: number; name: string; temperature: number; util: number;
  memTotal: number; memFree: number; memUsed: number; power: number;
  idleOccupied: boolean;
}

const gb = (mb: number) => (mb / 1024).toFixed(1);
const utilColor = (v: number) => (v < 30 ? "bg-emerald-500" : v < 70 ? "bg-amber-500" : "bg-rose-500");
const memColor = (frac: number) => (frac < 0.5 ? "bg-sky-500" : frac < 0.85 ? "bg-amber-500" : "bg-rose-500");

export default function GpuStatus() {
  const { t } = useLocale();
  const [gpus, setGpus] = useState<Gpu[]>([]);
  const [ok, setOk] = useState(true);
  useEffect(() => {
    const load = () =>
      fetch("/api/gpu").then((r) => r.json()).then((d) => { setGpus(d.gpus || []); setOk(!!d.hasNvidiaSmi); });
    load();
    const t = setInterval(load, 2500);
    return () => clearInterval(t);
  }, []);

  if (!ok) return <div className="text-sm text-neutral-500">{t("gpu.unavailable")}</div>;

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {gpus.map((g) => {
        const memFrac = g.memTotal ? g.memUsed / g.memTotal : 0;
        return (
          <div key={g.index} className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="badge">#{g.index}</span>
                <span className="text-sm font-medium">{g.name}</span>
                {g.idleOccupied && (
                  <span className="badge border border-amber-600 text-amber-300" title={t("gpu.idleTitle")}>
                    {t("gpu.idle")}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 text-xs text-neutral-400 tnum">
                <span className="flex items-center gap-1"><Thermometer size={13} />{g.temperature}°C</span>
                <span className="flex items-center gap-1"><Zap size={13} />{Math.round(g.power)}W</span>
              </div>
            </div>
            <div className="space-y-3 text-xs">
              <div>
                <div className="flex justify-between mb-1 text-neutral-400">
                  <span className="flex items-center gap-1"><Cpu size={13} /> GPU Load</span>
                  <span className="tnum">{g.util}%</span>
                </div>
                <div className="h-1.5 bg-panel2 rounded-full overflow-hidden">
                  <div className={`h-full ${utilColor(g.util)}`} style={{ width: `${g.util}%` }} />
                </div>
              </div>
              <div>
                <div className="flex justify-between mb-1 text-neutral-400">
                  <span>VRAM</span>
                  <span className="tnum">{gb(g.memUsed)} / {gb(g.memTotal)} GB · {t("gpu.free")} {gb(g.memFree)} GB</span>
                </div>
                <div className="h-1.5 bg-panel2 rounded-full overflow-hidden">
                  <div className={`h-full ${memColor(memFrac)}`} style={{ width: `${memFrac * 100}%` }} />
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
