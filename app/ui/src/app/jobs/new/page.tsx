"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import TopBar from "@/components/TopBar";

// Recommended VL evaluators. "" = use the server-configured default model.
// "__custom__" reveals a free-text field for any HF repo id or local path.
const MODEL_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "기본값 (서버 설정)" },
  { value: "huihui-ai/Huihui-Qwen3-VL-8B-Instruct-abliterated", label: "Qwen3-VL 8B abliterated (비검열, 기본)" },
  { value: "Qwen/Qwen3-VL-8B-Instruct", label: "Qwen3-VL 8B Instruct (공식)" },
  { value: "Qwen/Qwen3-VL-4B-Instruct", label: "Qwen3-VL 4B Instruct (빠름)" },
  { value: "Qwen/Qwen3-VL-2B-Instruct", label: "Qwen3-VL 2B Instruct (최속·경량)" },
  { value: "__custom__", label: "직접 입력 (HF repo id / 로컬 경로)" },
];

export default function NewJob() {
  const router = useRouter();
  const [datasets, setDatasets] = useState<any[]>([]);
  const [gpus, setGpus] = useState<any[]>([]);
  const [defaultModel, setDefaultModel] = useState("");
  const [form, setForm] = useState<any>({
    source_folder: "",
    mode: "auto",
    recaption: true,
    do_delete: false,
    vram_mode: "auto",
    auto_free_gpu: true,
    dry_run: false,
    target: "",
    per_bucket_cap: "",
    gpu_ids: "0",
    model: "",
    modelCustom: "",
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/settings").then((r) => r.json()).then((d) => setDefaultModel(d.default_model || ""));
    fetch("/api/datasets").then((r) => r.json()).then((d) => {
      setDatasets(d.datasets || []);
      if (d.datasets?.[0]) setForm((f: any) => ({ ...f, source_folder: d.datasets[0].path }));
    });
    fetch("/api/gpu").then((r) => r.json()).then((d) => {
      const g = d.gpus || [];
      setGpus(g);
      // default to the GPU with the most free VRAM
      if (g.length) {
        const best = [...g].sort((a, b) => b.memFree - a.memFree)[0];
        setForm((f: any) => ({ ...f, gpu_ids: String(best.index) }));
      }
    });
  }, []);

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const submit = async () => {
    setBusy(true);
    const cap = form.per_bucket_cap ? Number(form.per_bucket_cap) : null;
    const model = form.model === "__custom__" ? (form.modelCustom || undefined) : (form.model || undefined);
    const res = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        model,
        target: form.target ? Number(form.target) : null,
        coverage: cap ? { per_bucket_cap: cap } : undefined,
      }),
    });
    const d = await res.json();
    setBusy(false);
    if (d.job) router.push(`/jobs/${d.job.id}`);
  };

  const Row = ({ label, children }: any) => (
    <label className="flex items-center justify-between gap-4 py-2">
      <span className="text-sm text-neutral-300">{label}</span>
      <div className="w-64">{children}</div>
    </label>
  );

  return (
    <>
      <TopBar title="New Curation Job" />
      <div className="p-5 max-w-2xl">
        <div className="card p-5 divide-y divide-edge">
          <Row label="데이터셋">
            <select className="input" value={form.source_folder} onChange={(e) => set("source_folder", e.target.value)}>
              {datasets.map((d) => {
                const multiRoot = new Set(datasets.map((x) => x.root)).size > 1;
                return (
                  <option key={d.path} value={d.path}>
                    {d.name} ({d.images}){multiRoot ? ` · ${d.root}` : ""}
                  </option>
                );
              })}
            </select>
          </Row>
          <Row label="평가 모델 (VL)">
            <select className="input" value={form.model} onChange={(e) => set("model", e.target.value)}>
              {MODEL_OPTIONS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.value === "" && defaultModel ? `기본값 (${defaultModel})` : m.label}
                </option>
              ))}
            </select>
            {form.model === "__custom__" && (
              <input className="input mt-2" placeholder="예: Qwen/Qwen3-VL-8B-Instruct 또는 /경로/모델"
                value={form.modelCustom} onChange={(e) => set("modelCustom", e.target.value)} />
            )}
          </Row>
          <Row label="모드">
            <select className="input" value={form.mode} onChange={(e) => set("mode", e.target.value)}>
              <option value="auto">자동 (분석→적용)</option>
              <option value="review">리뷰 (분석→수동 확인→적용)</option>
            </select>
          </Row>
          <Row label="목표 유지 수 (선택)">
            <input className="input" type="number" placeholder="비우면 자동 균형" value={form.target}
              onChange={(e) => set("target", e.target.value)} />
          </Row>
          <Row label="버킷(뷰×샷)당 최대 장수">
            <input className="input" type="number" placeholder="비우면 자동 (예: 5)" value={form.per_bucket_cap}
              onChange={(e) => set("per_bucket_cap", e.target.value)} />
          </Row>
          <Row label="GPU">
            <select className="input" value={form.gpu_ids} onChange={(e) => set("gpu_ids", e.target.value)}>
              {gpus.length === 0 && <option value="0">GPU 0</option>}
              {gpus.map((g) => (
                <option key={g.index} value={String(g.index)}>
                  #{g.index} {g.name} · 여유 {(g.memFree / 1024).toFixed(0)}GB
                  {g.idleOccupied ? " (유휴 점유→확보)" : g.util > 8 ? " (사용중)" : ""}
                </option>
              ))}
            </select>
          </Row>
          <Row label="비검열 캡션 재생성">
            <input type="checkbox" checked={form.recaption} onChange={(e) => set("recaption", e.target.checked)} />
          </Row>
          <Row label="유휴 GPU 자동 확보 (idle ComfyUI 정지)">
            <input type="checkbox" checked={form.auto_free_gpu} onChange={(e) => set("auto_free_gpu", e.target.checked)} />
          </Row>
          <Row label="VRAM 모드">
            <select className="input" value={form.vram_mode} onChange={(e) => set("vram_mode", e.target.value)}>
              <option value="auto">자동 (여유 있으면 bf16, 없으면 fp8)</option>
              <option value="bf16">bf16 강제 (빠름·VRAM 여유 필요)</option>
              <option value="fp8">fp8 강제 (공유 GPU 공존)</option>
            </select>
          </Row>
          <Row label="리젝트 하드 삭제 (기본: 격리 이동)">
            <input type="checkbox" checked={form.do_delete} onChange={(e) => set("do_delete", e.target.checked)} />
          </Row>
          <Row label="Dry-run (파일 변경 없음)">
            <input type="checkbox" checked={form.dry_run} onChange={(e) => set("dry_run", e.target.checked)} />
          </Row>
        </div>
        <div className="mt-4 flex gap-2">
          <button className="btn btn-primary" disabled={busy || !form.source_folder} onClick={submit}>
            {busy ? "생성 중..." : "작업 시작"}
          </button>
        </div>
        <p className="text-xs text-neutral-500 mt-3">
          자동 모드는 분석 후 즉시 적용합니다. 리뷰 모드는 분석 후 갤러리에서 keep/reject를 수정한 뒤 적용합니다.
          리젝트는 <code>{"<dataset>_rejected/"}</code>로 이동(되돌리기 가능)합니다.
        </p>
      </div>
    </>
  );
}
