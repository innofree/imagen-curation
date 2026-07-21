import path from "path";
import fs from "fs";
import YAML from "yaml";

// The UI runs with cwd = <project>/app/ui.  Layout:
//   PACKAGE_DIR  = app/         -> holds the `curation` python package (PYTHONPATH)
//   PROJECT_ROOT = <project>/   -> Dockerfile, docs, paths.yaml
//   IMAGEN_ROOT  = <project>/.. -> imagen-lab tree root (datasets/HF/python defaults)
export const UI_DIR = process.cwd();
export const PACKAGE_DIR = path.resolve(UI_DIR, "..");
const PROJECT_ROOT = path.resolve(UI_DIR, "..", "..");

// Shared config, analogous to ComfyUI's extra_model_paths.yaml. Optional:
// env var > paths.yaml > derived default. See paths.yaml.example at the root.
function loadYaml(): Record<string, string> {
  for (const name of ["paths.yaml", "paths.yml"]) {
    const p = path.join(PROJECT_ROOT, name);
    if (fs.existsSync(p)) {
      try {
        return (YAML.parse(fs.readFileSync(p, "utf8")) as Record<string, string>) || {};
      } catch {
        return {};
      }
    }
  }
  return {};
}
const y = loadYaml();
const pick = (env: string, key: string, def: string) =>
  process.env[env] || y[key] || def;

export const IMAGEN_ROOT = pick("IMAGEN_ROOT", "imagen_root", path.resolve(PROJECT_ROOT, ".."));
export const DATASETS_DIR = pick("DATASETS_DIR", "datasets_dir", path.join(IMAGEN_ROOT, "datasets"));
export const HF_HOME = pick("HF_HOME", "hf_home", path.join(IMAGEN_ROOT, "downloads", "hf"));
export const DB_PATH = path.resolve(UI_DIR, "curation.db");
export const LOG_DIR = path.resolve(IMAGEN_ROOT, "logs");

// Default VL model (env > paths.yaml > built-in). Kept in sync with
// curation/config.py DEFAULT_VL_MODEL. Used as the New-Curation default and
// the worker fallback when a job does not pin a model.
export const DEFAULT_MODEL = pick(
  "DEFAULT_MODEL", "default_model",
  "huihui-ai/Huihui-Qwen3-VL-8B-Instruct-abliterated"
);

// Optional HF token for gated/rate-limited model pulls (env > paths.yaml).
// Injected into the worker env as HF_TOKEN; never returned raw to the client.
export const HF_TOKEN =
  process.env.HF_TOKEN || process.env.HUGGING_FACE_HUB_TOKEN || y.hf_token || "";

// Additional dataset roots beyond DATASETS_DIR (env or paths.yaml). Comma- or
// newline-separated absolute paths, each scanned like the primary datasets dir.
export const EXTRA_DATASET_DIRS: string[] = String(
  process.env.EXTRA_DATASET_DIRS || y.extra_dataset_dirs || ""
)
  .split(/[,\n]/)
  .map((s) => s.trim())
  .filter(Boolean);

// Python interpreter from the ai-toolkit conda env (or the container's python3).
export function resolvePython(): string {
  const candidates = [
    process.env.CURATION_PYTHON,
    y.python,
    path.resolve(IMAGEN_ROOT, "miniconda3", "envs", "ai-toolkit", "bin", "python"),
    "python3",
  ].filter(Boolean) as string[];
  for (const c of candidates) {
    if (c === "python3" || fs.existsSync(c)) return c;
  }
  return "python3";
}

// List candidate dataset folders (flat image folders) across the primary
// DATASETS_DIR plus any EXTRA_DATASET_DIRS. Each entry carries its absolute
// path (the UI submits that, so extra-root datasets resolve unambiguously) and
// the root it came from (shown when more than one root is configured).
export function listDatasets(): { name: string; path: string; images: number; root: string }[] {
  const roots = [DATASETS_DIR, ...EXTRA_DATASET_DIRS];
  const out: { name: string; path: string; images: number; root: string }[] = [];
  const seen = new Set<string>();
  for (const root of roots) {
    if (!root || !fs.existsSync(root)) continue;
    for (const name of fs.readdirSync(root)) {
      const full = path.join(root, name);
      if (seen.has(full)) continue;
      try {
        if (!fs.statSync(full).isDirectory()) continue;
      } catch {
        continue;
      }
      if (name.startsWith("_") || name.startsWith(".")) continue;
      if (name.endsWith("_rejected")) continue; // quarantine siblings created by apply
      let images = 0;
      for (const f of fs.readdirSync(full)) {
        if (/\.(png|jpe?g|webp|bmp)$/i.test(f)) images++;
      }
      seen.add(full);
      out.push({ name, path: full, images, root });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
