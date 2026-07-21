import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { IMAGEN_ROOT, EXTRA_DATASET_DIRS } from "@/lib/paths";

export const dynamic = "force-dynamic";

// Image types only. Anything not in this map is refused — this endpoint must
// never serve config/secrets/db/source (e.g. paths.yaml, .env, curation.db).
const TYPES: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".jpe": "image/jpeg",
  ".webp": "image/webp", ".bmp": "image/bmp", ".gif": "image/gif",
  ".tif": "image/tiff", ".tiff": "image/tiff", ".avif": "image/avif",
  ".heic": "image/heic", ".heif": "image/heif",
};

// Canonicalized roots a served file must resolve under: the imagen-lab tree plus
// any configured extra dataset roots (which may live outside IMAGEN_ROOT).
// realpath is applied so a symlink cannot escape a root.
const ALLOWED_ROOTS: string[] = [IMAGEN_ROOT, ...EXTRA_DATASET_DIRS]
  .map((r) => { try { return fs.realpathSync(r); } catch { return null; } })
  .filter((r): r is string => !!r);

function underAllowedRoot(real: string): boolean {
  return ALLOWED_ROOTS.some((root) => real === root || real.startsWith(root + path.sep));
}

// Serve an image/thumbnail from disk. Hardened against path traversal, symlink
// escape, and non-image disclosure. ?path=<absolute or IMAGEN_ROOT-relative path>
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams.get("path");
  if (!p) return new NextResponse("missing path", { status: 400 });

  const abs = path.resolve(path.isAbsolute(p) ? p : path.join(IMAGEN_ROOT, p));
  // Resolve symlinks to the real target; a missing file throws here -> 404.
  let real: string;
  try { real = fs.realpathSync(abs); } catch { return new NextResponse("not found", { status: 404 }); }

  // Extension gate is enforced on the REAL path (a `.jpg` symlink pointing at
  // `.env` resolves to a non-image extension and is rejected).
  const ext = path.extname(real).toLowerCase();
  if (!(ext in TYPES)) return new NextResponse("forbidden", { status: 403 });

  let st: fs.Stats;
  try { st = fs.statSync(real); } catch { return new NextResponse("not found", { status: 404 }); }
  if (!st.isFile() || !underAllowedRoot(real)) return new NextResponse("forbidden", { status: 403 });

  // Path-addressed but mutable (apply moves/replaces files), so revalidate via
  // ETag instead of a fixed TTL — a moved/regenerated file changes mtime/size
  // and invalidates the cache immediately, while unchanged files 304 cheaply.
  const etag = `"${Math.round(st.mtimeMs)}-${st.size}"`;
  const cache = "private, no-cache";
  if (req.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers: { ETag: etag, "Cache-Control": cache } });
  }
  const buf = await fs.promises.readFile(real);
  return new NextResponse(buf, {
    headers: { "Content-Type": TYPES[ext], "Cache-Control": cache, ETag: etag },
  });
}
