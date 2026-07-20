import path from "path";
import fs from "fs";

// The UI runs with cwd = curation/ui. IMAGEN_ROOT is two levels up.
export const UI_DIR = process.cwd();
export const IMAGEN_ROOT =
  process.env.IMAGEN_ROOT || path.resolve(UI_DIR, "..", "..");
export const CURATION_ROOT = path.resolve(IMAGEN_ROOT, "curation");
export const DATASETS_DIR = path.resolve(IMAGEN_ROOT, "datasets");
export const HF_HOME = path.resolve(IMAGEN_ROOT, "downloads", "hf");
export const DB_PATH = path.resolve(UI_DIR, "curation.db");

// Python interpreter from the ai-toolkit conda env (has transformers/cv2).
export function resolvePython(): string {
  const candidates = [
    process.env.CURATION_PYTHON,
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
    let images = 0;
    for (const f of fs.readdirSync(full)) {
      if (/\.(png|jpe?g|webp|bmp)$/i.test(f)) images++;
    }
    out.push({ name, path: full, images });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
