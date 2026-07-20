"""Report generation: JSON, Markdown summary, and a local HTML gallery.

The HTML gallery is written to disk for local viewing only; it is deliberately
NOT published to any external service because the datasets can contain
sensitive/suggestive imagery.
"""
from __future__ import annotations

import base64
import html
import json
import os
from typing import Any, Dict, List

from PIL import Image


def _thumb_data_uri(path: str, size: int = 240) -> str:
    try:
        im = Image.open(path).convert("RGB")
        im.thumbnail((size, size))
        from io import BytesIO

        buf = BytesIO()
        im.save(buf, format="JPEG", quality=80)
        b64 = base64.b64encode(buf.getvalue()).decode("ascii")
        return f"data:image/jpeg;base64,{b64}"
    except Exception:  # noqa: BLE001
        return ""


def write_json(out_dir: str, payload: Dict[str, Any]) -> str:
    path = os.path.join(out_dir, "curation_report.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    return path


def write_markdown(out_dir: str, summary: Dict[str, Any], records: List[Dict]) -> str:
    s = summary["stats"]
    lines: List[str] = []
    lines.append(f"# 큐레이션 리포트 — {summary.get('source_folder','')}\n")
    verdict = summary["verdict"]
    badge = {"sufficient": "✅ 충분", "marginal": "⚠️ 보통", "insufficient": "❌ 부족"}.get(verdict, verdict)
    lines.append(f"**데이터셋 충분성: {badge}**\n")
    if summary.get("gaps"):
        lines.append("**부족한 커버리지:**")
        for g in summary["gaps"]:
            lines.append(f"- {g}")
        lines.append("")
    lines.append("## 요약")
    lines.append(f"- 입력: **{s['n_input']}** 장")
    lines.append(f"- 하드 리젝트(품질/중복/부적합): **{s['n_hard_reject']}** 장")
    lines.append(f"- 과다 버킷 리젝트: **{s['n_overflow_reject']}** 장 (버킷 상한 {summary['cap']})")
    lines.append(f"- **최종 유지: {s['n_final_keep']} 장**")
    lines.append("")
    lines.append(f"- 정면 얼굴: {s['front_face']} · 3/4: {s['three_quarter']} · "
                 f"프로파일: {s['profiles']} · 전신: {s['full_body']} · 뷰 다양성: {s['distinct_views']}")
    lines.append("")
    lines.append("## 뷰 × 샷 커버리지")
    lines.append("| 버킷 (view\\|shot) | 전체 | 유지 |")
    lines.append("|---|---:|---:|")
    for row in summary["coverage_table"]:
        lines.append(f"| {row['bucket']} | {row['total']} | {row['kept']} |")
    lines.append("")

    rejects = [r for r in records if r.get("auto_decision") == "reject"]
    if rejects:
        lines.append(f"## 리젝트 사유 ({len(rejects)}장)")
        for r in rejects[:200]:
            lines.append(f"- `{r['filename']}` — {r.get('auto_reason','')}")
        lines.append("")

    path = os.path.join(out_dir, "curation_report.md")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    return path


def write_gallery(out_dir: str, summary: Dict[str, Any], records: List[Dict]) -> str:
    """Self-contained HTML gallery grouped by bucket with keep/reject styling."""
    by_bucket: Dict[str, List[Dict]] = {}
    for r in records:
        by_bucket.setdefault(r.get("bucket") or "(unbucketed)", []).append(r)

    def card(r: Dict) -> str:
        decision = r.get("user_decision") or r.get("auto_decision", "keep")
        vl = r.get("vl", {})
        uri = _thumb_data_uri(r["path"])
        cls = "keep" if decision == "keep" else "reject"
        badges = (
            f"<span class='b'>{html.escape(vl.get('shot_type',''))}</span>"
            f"<span class='b'>{html.escape(vl.get('view_angle',''))}</span>"
            f"<span class='b'>face:{html.escape(vl.get('face_clarity',''))}</span>"
        )
        reason = html.escape(r.get("auto_reason", "") or vl.get("reason", ""))
        return (
            f"<div class='card {cls}'>"
            f"<img loading='lazy' src='{uri}'/>"
            f"<div class='meta'>{badges}"
            f"<div class='sc'>Q {r.get('quality_score',0):.2f} · "
            f"suit {vl.get('training_suitability','?')} · uniq {r.get('uniqueness',0):.2f} · "
            f"faceSharp {r.get('face_sharpness',0):.0f}</div>"
            f"<div class='fn'>{html.escape(r['filename'])}</div>"
            f"<div class='rs'>{reason}</div></div></div>"
        )

    s = summary["stats"]
    sections = []
    for bucket in sorted(by_bucket):
        items = sorted(by_bucket[bucket], key=lambda r: r.get("auto_decision") != "keep")
        cards = "".join(card(r) for r in items)
        sections.append(f"<h2>{html.escape(bucket)} <small>({len(items)})</small></h2>"
                        f"<div class='grid'>{cards}</div>")

    style = """
    body{font-family:system-ui,sans-serif;margin:0;padding:20px;background:#111;color:#eee}
    h1{font-size:20px} h2{font-size:15px;margin-top:28px;border-bottom:1px solid #333;padding-bottom:6px}
    .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px}
    .card{border:2px solid #333;border-radius:8px;overflow:hidden;background:#1b1b1b}
    .card.keep{border-color:#2e7d32} .card.reject{border-color:#8a2b2b;opacity:.72}
    .card img{width:100%;height:200px;object-fit:cover;display:block}
    .meta{padding:6px;font-size:11px} .b{display:inline-block;background:#333;border-radius:4px;padding:1px 5px;margin:1px}
    .sc{color:#9ad;margin-top:4px} .fn{color:#888;font-size:10px;word-break:break-all;margin-top:3px}
    .rs{color:#c99;font-size:10px;margin-top:3px}
    .summary{background:#1b1b1b;border:1px solid #333;border-radius:8px;padding:12px;margin-bottom:16px}
    """
    verdict = summary["verdict"]
    header = (
        f"<div class='summary'><b>충분성: {verdict}</b> · 입력 {s['n_input']} · "
        f"유지 {s['n_final_keep']} · 리젝트 {s['n_input']-s['n_final_keep']} · "
        f"cap {summary['cap']}<br>정면 {s['front_face']} · 3/4 {s['three_quarter']} · "
        f"프로파일 {s['profiles']} · 전신 {s['full_body']}"
        + ("<br>gaps: " + html.escape("; ".join(summary["gaps"])) if summary.get("gaps") else "")
        + "</div>"
    )
    doc = (
        f"<!doctype html><html><head><meta charset='utf-8'>"
        f"<title>Curation — {html.escape(summary.get('source_folder',''))}</title>"
        f"<style>{style}</style></head><body>"
        f"<h1>큐레이션 갤러리 — {html.escape(summary.get('source_folder',''))}</h1>"
        f"{header}{''.join(sections)}</body></html>"
    )
    path = os.path.join(out_dir, "curation_gallery.html")
    with open(path, "w", encoding="utf-8") as f:
        f.write(doc)
    return path
