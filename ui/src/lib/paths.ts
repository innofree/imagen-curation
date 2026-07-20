import path from "path";
import fs from "fs";
import YAML from "yaml";

// The UI runs with cwd = curation/ui. The curation dir (holding paths.yaml) is
// one level up; the imagen-lab root defaults to two levels up.
export const UI_DIR = process.cwd();
const CURATION_ROOT = path.resolve(UI_DIR, "..");

// Shared config, analogous to ComfyUI's extra_model_paths.yaml. Optional:
// env var > paths.yaml > derived default. See curation/paths.yaml.example.
function loadYaml(): Record<string, string> {
  for (const name of ["paths.yaml", "paths.yml"]) {
    const p = path.join(CURATION_ROOT, name);
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

export const IMAGEN_ROOT = pick("IMAGEN_ROOT", "imagen_root", path.resolve(UI_DIR, "..", ".."));
export const DATASETS_DIR = pick("DATASETS_DIR", "datasets_dir", path.join(IMAGEN_ROOT, "datasets"));
export const HF_HOME = pick("HF_HOME", "hf_home", path.join(IMAGEN_ROOT, "downloads", "hf"));
export const DB_PATH = path.resolve(UI_DIR, "curation.db");

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

// List candidate dataset folders (flat image folders under datasets/).
export function listDatasets(): { name: string; path: string; images: number }[] {
  if (!fs.existsSync(DATASETS_DIR)) return [];
  const out: { name: string; path: string; images: number }[] = [];
  for (const name of fs.readdirSync(DATASETS_DIR)) {
    const full = path.join(DATASETS_DIR, name);
    if (!fs.statSync(full).isDirectory()) continue;
    if (name.startsWith("_") || name.startsWith(".")) continue;
    if (name.endsWith("_rejected")) continue; // quarantine siblings created by apply
    let images = 0;
    for (const f of fs.readdirSync(full)) {
      if (/\.(png|jpe?g|webp|bmp)$/i.test(f)) images++;
    }
    out.push({ name, path: full, images });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
