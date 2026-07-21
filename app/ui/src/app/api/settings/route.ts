import { NextRequest, NextResponse } from "next/server";
import {
  IMAGEN_ROOT, DATASETS_DIR, HF_HOME, DB_PATH, resolvePython,
  DEFAULT_MODEL, HF_TOKEN, EXTRA_DATASET_DIRS,
} from "@/lib/paths";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

async function getSetting(key: string, fallback: string): Promise<string> {
  const row = await prisma.settings.findUnique({ where: { key } });
  return row?.value ?? fallback;
}

export async function GET() {
  const ui_font = await getSetting("ui_font", "noto");
  const locale = await getSetting("locale", "ko");
  return NextResponse.json({
    imagen_root: IMAGEN_ROOT,
    datasets_dir: DATASETS_DIR,
    extra_dataset_dirs: EXTRA_DATASET_DIRS.join(", ") || "(none)",
    hf_home: HF_HOME,
    hf_token_configured: !!HF_TOKEN,
    db_path: DB_PATH,
    python: resolvePython(),
    default_model: DEFAULT_MODEL,
    ui_font,
    locale,
  });
}

// POST { key, value } -> upsert a user setting (e.g. ui_font).
export async function POST(req: NextRequest) {
  const { key, value } = await req.json();
  if (!key) return NextResponse.json({ error: "key required" }, { status: 400 });
  await prisma.settings.upsert({
    where: { key },
    update: { value: String(value) },
    create: { key, value: String(value) },
  });
  return NextResponse.json({ ok: true });
}
