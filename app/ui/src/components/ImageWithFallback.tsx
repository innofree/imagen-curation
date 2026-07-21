"use client";
import { useState } from "react";
import { ImageOff, Loader2 } from "lucide-react";

// <img> wrapper that degrades gracefully instead of showing the browser's
// broken-image glyph. If the primary src fails (e.g. a reject whose full-res
// original was moved to <dataset>_rejected/), it tries `fallbackSrc` (typically
// the persisted thumbnail, which always lives in the run dir) before finally
// showing a labelled placeholder. A spinner shows until the image decodes.
export default function ImageWithFallback({
  src, fallbackSrc, alt, className, imgClassName, onClick, note,
}: {
  src: string;
  fallbackSrc?: string;    // tried if `src` errors (e.g. thumbnail for a moved original)
  alt?: string;
  className?: string;      // wrapper (sizing) classes
  imgClassName?: string;   // <img> classes
  onClick?: () => void;
  note?: string;           // extra hint shown under the placeholder label
}) {
  // `phase`: which source we're on. Reset synchronously during render when the
  // source changes (the React "adjust state on prop change" pattern) so a reused
  // instance never paints one stale frame with the old phase before an effect
  // fires.
  const [phase, setPhase] = useState<"primary" | "fallback" | "error">("primary");
  const [loaded, setLoaded] = useState(false);
  const [prevKey, setPrevKey] = useState(src + "|" + (fallbackSrc || ""));
  const key = src + "|" + (fallbackSrc || "");
  if (key !== prevKey) {
    setPrevKey(key);
    setPhase("primary");
    setLoaded(false);
  }

  const curSrc = phase === "primary" ? src : phase === "fallback" ? fallbackSrc : "";

  const onError = () => {
    // primary -> fallback (if any) -> placeholder
    if (phase === "primary" && fallbackSrc && fallbackSrc !== src) setPhase("fallback");
    else setPhase("error");
  };

  return (
    <div className={`relative ${className || ""}`} onClick={onClick}>
      {phase !== "error" && curSrc ? (
        <img
          src={curSrc}
          alt={alt}
          loading="lazy"
          decoding="async"
          className={imgClassName}
          onLoad={() => setLoaded(true)}
          onError={onError}
        />
      ) : (
        <div className={`flex flex-col items-center justify-center gap-1 text-center text-neutral-500 bg-panel2 ${imgClassName || ""}`}>
          <ImageOff size={22} />
          <span className="text-[11px] leading-tight px-2">이미지 없음 / 이동됨</span>
          {note && <span className="text-[10px] text-neutral-600 px-2 break-all">{note}</span>}
        </div>
      )}
      {phase !== "error" && !loaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-panel2/60 pointer-events-none">
          <Loader2 size={18} className="animate-spin text-neutral-500" />
        </div>
      )}
    </div>
  );
}
