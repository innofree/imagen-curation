"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import TopBar from "@/components/TopBar";
import { useLocale } from "@/components/LocaleProvider";
import { PURPOSE_OPTIONS, DEFAULT_PURPOSE } from "@/lib/purposes";

// Recommended VL evaluators. "" = use the server-configured default model.
// "__custom__" reveals a free-text field for any HF repo id or local path.
const MODEL_OPTIONS: { value: string; labelKey: string }[] = [
  { value: "", labelKey: "new.model_default" },
  { value: "huihui-ai/Huihui-Qwen3-VL-8B-Instruct-abliterated", labelKey: "new.model_qwen3vl_8b_abliterated" },
  { value: "Qwen/Qwen3-VL-8B-Instruct", labelKey: "new.model_qwen3vl_8b" },
  { value: "Qwen/Qwen3-VL-4B-Instruct", labelKey: "new.model_qwen3vl_4b" },
  { value: "Qwen/Qwen3-VL-2B-Instruct", labelKey: "new.model_qwen3vl_2b" },
  { value: "__custom__", labelKey: "new.model_custom" },
];

export default function NewJob() {
  const router = useRouter();
  const { t } = useLocale();
  const [datasets, setDatasets] = useState<any[]>([]);
  const [gpus, setGpus] = useState<any[]>([]);
  const [defaultModel, setDefaultModel] = useState("");
  const [form, setForm] = useState<any>({
    source_folder: "",
    purpose: DEFAULT_PURPOSE,
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
      <TopBar title={t("new.title")} />
      <div className="p-5 max-w-2xl">
        <div className="card p-5 divide-y divide-edge">
          <Row label={t("new.dataset")}>
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
          <Row label={t("new.purpose")}>
            <select className="input" value={form.purpose} onChange={(e) => set("purpose", e.target.value)}>
              {PURPOSE_OPTIONS.map((p) => (
                <option key={p.value} value={p.value}>
                  {t(`purpose.${p.value}`)} — {t(`purpose.${p.value}_desc`)}
                </option>
              ))}
            </select>
          </Row>
          <Row label={t("new.eval_model")}>
            <select className="input" value={form.model} onChange={(e) => set("model", e.target.value)}>
              {MODEL_OPTIONS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.value === "" && defaultModel ? t("new.model_default_named", { model: defaultModel }) : t(m.labelKey)}
                </option>
              ))}
            </select>
            {form.model === "__custom__" && (
              <input className="input mt-2" placeholder={t("new.model_custom_placeholder")}
                value={form.modelCustom} onChange={(e) => set("modelCustom", e.target.value)} />
            )}
          </Row>
          <Row label={t("new.mode")}>
            <select className="input" value={form.mode} onChange={(e) => set("mode", e.target.value)}>
              <option value="auto">{t("new.mode_auto")}</option>
              <option value="review">{t("new.mode_review")}</option>
            </select>
          </Row>
          <Row label={t("new.target")}>
            <input className="input" type="number" placeholder={t("new.target_placeholder")} value={form.target}
              onChange={(e) => set("target", e.target.value)} />
          </Row>
          <Row label={t("new.per_bucket_cap")}>
            <input className="input" type="number" placeholder={t("new.per_bucket_cap_placeholder")} value={form.per_bucket_cap}
              onChange={(e) => set("per_bucket_cap", e.target.value)} />
          </Row>
          <Row label={t("new.gpu")}>
            <select className="input" value={form.gpu_ids} onChange={(e) => set("gpu_ids", e.target.value)}>
              {gpus.length === 0 && <option value="0">GPU 0</option>}
              {gpus.map((g) => (
                <option key={g.index} value={String(g.index)}>
                  #{g.index} {g.name} · {t("new.gpu_free", { gb: (g.memFree / 1024).toFixed(0) })}
                  {g.idleOccupied ? ` ${t("new.gpu_idle_occupied")}` : g.util > 8 ? ` ${t("new.gpu_in_use")}` : ""}
                </option>
              ))}
            </select>
          </Row>
          <Row label={t("new.recaption")}>
            <input type="checkbox" checked={form.recaption} onChange={(e) => set("recaption", e.target.checked)} />
          </Row>
          <Row label={t("new.auto_free_gpu")}>
            <input type="checkbox" checked={form.auto_free_gpu} onChange={(e) => set("auto_free_gpu", e.target.checked)} />
          </Row>
          <Row label={t("new.vram_mode")}>
            <select className="input" value={form.vram_mode} onChange={(e) => set("vram_mode", e.target.value)}>
              <option value="auto">{t("new.vram_auto")}</option>
              <option value="bf16">{t("new.vram_bf16")}</option>
              <option value="fp8">{t("new.vram_fp8")}</option>
            </select>
          </Row>
          <Row label={t("new.do_delete")}>
            <input type="checkbox" checked={form.do_delete} onChange={(e) => set("do_delete", e.target.checked)} />
          </Row>
          <Row label={t("new.dry_run")}>
            <input type="checkbox" checked={form.dry_run} onChange={(e) => set("dry_run", e.target.checked)} />
          </Row>
        </div>
        <div className="mt-4 flex gap-2">
          <button className="btn btn-primary" disabled={busy || !form.source_folder} onClick={submit}>
            {busy ? t("new.submitting") : t("new.submit")}
          </button>
        </div>
        <p className="text-xs text-neutral-500 mt-3">
          {t("new.help_intro")}
          {t("new.help_reject_prefix")}<code>{"<dataset>_rejected/"}</code>{t("new.help_reject_suffix")}
        </p>
      </div>
    </>
  );
}
