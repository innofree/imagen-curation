import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { IMAGEN_ROOT } from "@/lib/paths";

export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".bmp": "image/bmp",
};

// Serve an image/thumbnail from disk. Restricted to IMAGEN_ROOT to prevent
// path traversal. ?path=<absolute or repo-relative path>
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams.get("path");
  if (!p) return new NextResponse("missing path", { status: 400 });
  const abs = path.resolve(path.isAbsolute(p) ? p : path.join(IMAGEN_ROOT, p));
  if (!abs.startsWith(IMAGEN_ROOT + path.sep) && abs !== IMAGEN_ROOT) {
    return new NextResponse("forbidden", { status: 403 });
  }
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    return new NextResponse("not found", { status: 404 });
  }
  const ext = path.extname(abs).toLowerCase();
  const buf = await fs.promises.readFile(abs);
  return new NextResponse(buf, {
    headers: {
      "Content-Type": TYPES[ext] || "application/octet-stream",
      "Cache-Control": "no-store",
    },
  });
}
