import { NextResponse } from "next/server";
import { listDatasets } from "@/lib/paths";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ datasets: listDatasets() });
}
