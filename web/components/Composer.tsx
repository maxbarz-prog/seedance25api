"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ASPECT_RATIOS,
  DEFAULT_DURATION_S,
  DEFAULT_MODEL,
  IMAGE_ROLES,
  ImageRole,
  InputRole,
  MAX_IMAGES,
  MAX_REF_AUDIOS,
  MAX_REF_VIDEOS,
  MAX_PROMPT_CHARS,
  MAX_VARIATIONS,
  MIN_DURATION_S,
  MODEL_IDS,
  MODELS,
  ModelId,
  NATIVE_1080P_MODEL_IDS,
} from "@/lib/config";
import CreditsDialog, { CreditsBlock } from "./CreditsDialog";
import { BALANCE_EVENT } from "./Header";

const ROLE_LABELS: Record<ImageRole, string> = {
  reference: "Reference",
  first_frame: "First frame",
  last_frame: "Last frame",
};

interface Quote {
  credits: number;
  usd: number;
  perSecUsd: number;
}

const DRAFT_KEY = "remerged-draft";

export default function Composer() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState<ModelId>(DEFAULT_MODEL);
  const [durationS, setDurationS] = useState(DEFAULT_DURATION_S);
  const [aspect, setAspect] = useState<string>("16:9");
  const [audio, setAudio] = useState(false);
  const [mode, setMode] = useState<"upscaled-1080p" | "native-1080p">("upscaled-1080p");
  const [q, setQ] = useState<Quote | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [block, setBlock] = useState<CreditsBlock | null>(null);
  const [uploadsEnabled, setUploadsEnabled] = useState(false);
  const [images, setImages] = useState<
    { key: string; preview: string; role: InputRole; name: string }[]
  >([]);
  const [uploading, setUploading] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [seed, setSeed] = useState<string>("");
  const [cameraFixed, setCameraFixed] = useState(false);
  const [variations, setVariations] = useState(1);

  const maxDuration = MODELS[model].maxDurationS;

  useEffect(() => {
    fetch("/api/uploads")
      .then((r) => r.json())
      .then((d) => setUploadsEnabled(!!d.enabled))
      .catch(() => {});
  }, []);

  const imageCount = images.filter((i) => !i.role.startsWith("reference_")).length;
  const videoCount = images.filter((i) => i.role === "reference_video").length;
  const audioCount = images.filter((i) => i.role === "reference_audio").length;

  // Some models take only one kind of prompt (the lite pair is split into a
  // text-to-video and an image-to-video build), so the model list has to
  // follow what has actually been attached.
  const needs: "text" | "image" = imageCount > 0 ? "image" : "text";
  const compatible = (m: ModelId) =>
    (MODELS[m].accepts as readonly string[]).includes(needs);
  // 2.0 Fast and 2.0 Mini have no 1080p output at the provider, so the native
  // option is not offered for them at all.
  const canNative = (NATIVE_1080P_MODEL_IDS as readonly string[]).includes(model);

  async function addImages(files: FileList | null, kind: "image" | "video" | "audio" = "image") {
    if (!files || !files.length) return;
    setError(null);
    setUploading(true);
    try {
      const room =
        kind === "image"
          ? MAX_IMAGES - imageCount
          : kind === "video"
            ? MAX_REF_VIDEOS - videoCount
            : MAX_REF_AUDIOS - audioCount;
      for (const file of Array.from(files).slice(0, Math.max(0, room))) {
        const ok =
          kind === "image"
            ? ["image/jpeg", "image/png", "image/webp"].includes(file.type)
            : kind === "video"
              ? ["video/mp4", "video/quicktime"].includes(file.type)
              : ["audio/mpeg", "audio/wav"].includes(file.type);
        if (!ok) {
          setError(
            kind === "image"
              ? "Use JPEG, PNG or WebP images."
              : kind === "video"
                ? "Use an MP4 or MOV video."
                : "Use an MP3 or WAV file."
          );
          continue;
        }
        const res = await fetch("/api/uploads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contentType: file.type }),
        });
        if (res.status === 401) {
          router.push("/signup?next=/");
          return;
        }
        const p = await res.json();
        if (!res.ok) {
          setError(p.error || "Upload failed.");
          continue;
        }
        if (file.size > p.maxBytes) {
          setError(`That file is too large (limit ${Math.round(p.maxBytes / 1e6)} MB).`);
          continue;
        }
        const put = await fetch(p.url, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
        if (!put.ok) {
          setError("Upload failed.");
          continue;
        }
        setImages((prev) => [
          ...prev,
          {
            key: p.key,
            preview: kind === "image" ? URL.createObjectURL(file) : "",
            name: file.name,
            role:
              kind === "video"
                ? "reference_video"
                : kind === "audio"
                  ? "reference_audio"
                  : // First image defaults to "first frame" (image-to-video);
                    // later ones are free references.
                    prev.some((i) => !i.role.startsWith("reference_"))
                    ? "reference"
                    : "first_frame",
          },
        ]);
      }
    } finally {
      setUploading(false);
    }
  }

  // Draft survives the signup/membership/top-up detour.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d.prompt) setPrompt(d.prompt);
        if (d.model && MODEL_IDS.includes(d.model)) setModel(d.model);
        if (d.durationS) setDurationS(d.durationS);
        if (d.aspect) setAspect(d.aspect);
        if (typeof d.audio === "boolean") setAudio(d.audio);
        if (d.mode) setMode(d.mode);
      }
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({ prompt, model, durationS, aspect, audio, mode })
      );
    } catch {}
  }, [prompt, model, durationS, aspect, audio, mode]);

  useEffect(() => {
    if (durationS > maxDuration) setDurationS(maxDuration);
  }, [durationS, maxDuration]);

  useEffect(() => {
    if (!compatible(model)) {
      const fallback = MODEL_IDS.find(compatible);
      if (fallback) setModel(fallback);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needs, model]);

  useEffect(() => {
    if (!canNative && mode === "native-1080p") setMode("upscaled-1080p");
  }, [canNative, mode]);

  useEffect(() => {
    const ctl = new AbortController();
    const effectiveMode = canNative ? mode : "upscaled-1080p";
    const qs = new URLSearchParams({
      model,
      duration: String(Math.min(durationS, maxDuration)),
      mode: effectiveMode,
      audio: audio ? "1" : "0",
    });
    fetch(`/api/quote?${qs}`, { signal: ctl.signal })
      .then((r) => r.json())
      .then((d) => setQ(d.error ? null : d))
      .catch(() => {});
    return () => ctl.abort();
  }, [model, durationS, mode, maxDuration, audio, canNative]);

  async function generate() {
    setError(null);
    if (!prompt.trim()) {
      setError("Describe the video you want first.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          model,
          durationS,
          aspect,
          audio,
          mode,
          upscaleFactor: 2,
          images: images.map((i) => ({ key: i.key, role: i.role })),
          seed: seed.trim() === "" ? undefined : Number(seed),
          cameraFixed,
          variations,
        }),
      });
      const data = await res.json();
      if (res.status === 401) {
        router.push("/signup?next=/");
        return;
      }
      if (res.status === 402) {
        setBlock({
          reason:
            data.error === "membership_required"
              ? "membership_required"
              : "insufficient_credits",
          needed: data.needed,
          balance: data.balance,
        });
        return;
      }
      if (!res.ok) {
        setError(data.message || data.error || "Something went wrong.");
        return;
      }
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {}
      window.dispatchEvent(new Event(BALANCE_EVENT));
      router.push(variations > 1 ? "/library" : `/jobs/${data.id}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
      <CreditsDialog block={block} onClose={() => setBlock(null)} />
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value.slice(0, MAX_PROMPT_CHARS))}
        placeholder="A barista pours latte art in slow motion, warm cafe lighting, cinematic 35mm look…"
        rows={4}
        className="w-full resize-y rounded-xl border border-line bg-bg p-4 text-base outline-none focus:border-accent"
      />
      <div className="mt-1 flex items-center justify-between text-xs text-muted">
        <div className="flex items-center gap-2">
          {uploadsEnabled && imageCount < MAX_IMAGES && (
            <label className="cursor-pointer rounded-full border border-line px-3 py-1 hover:border-accent">
              {uploading ? "Uploading…" : "+ Image"}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                className="hidden"
                onChange={(e) => addImages(e.target.files, "image")}
              />
            </label>
          )}
          {uploadsEnabled && videoCount < MAX_REF_VIDEOS && (
            <label className="cursor-pointer rounded-full border border-line px-3 py-1 hover:border-accent">
              + Reference video
              <input
                type="file"
                accept="video/mp4,video/quicktime"
                className="hidden"
                onChange={(e) => addImages(e.target.files, "video")}
              />
            </label>
          )}
          {uploadsEnabled && audioCount < MAX_REF_AUDIOS && (
            <label className="cursor-pointer rounded-full border border-line px-3 py-1 hover:border-accent">
              + Audio
              <input
                type="file"
                accept="audio/mpeg,audio/wav"
                className="hidden"
                onChange={(e) => addImages(e.target.files, "audio")}
              />
            </label>
          )}
          {images.map((img) => (
            <span key={img.key} className="relative inline-flex items-center gap-1">
              {img.role.startsWith("reference_") ? (
                <span className="rounded-lg border border-line bg-bg px-2 py-1 text-[11px]">
                  {img.role === "reference_video" ? "🎬" : "🎵"} {img.name.slice(0, 18)}
                </span>
              ) : (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.preview} alt="" className="h-10 w-10 rounded-lg object-cover" />
                  <select
                    value={img.role}
                    onChange={(e) =>
                      setImages((prev) =>
                        prev.map((i) =>
                          i.key === img.key ? { ...i, role: e.target.value as ImageRole } : i
                        )
                      )
                    }
                    className="rounded-lg border border-line bg-bg px-1 py-0.5 text-[11px]"
                    aria-label="Image role"
                  >
                    {IMAGE_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                </>
              )}
              <button
                type="button"
                onClick={() => setImages((prev) => prev.filter((i) => i.key !== img.key))}
                className="absolute -left-1 -top-1 rounded-full bg-surface px-1 text-[10px] leading-none shadow"
                aria-label="Remove image"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
        <span>
          {prompt.length}/{MAX_PROMPT_CHARS}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
        <div className="flex items-center gap-1 rounded-full border border-line p-1 text-xs">
          {MODEL_IDS.map((id) => {
            const ok = compatible(id);
            return (
              <button
                key={id}
                onClick={() => setModel(id)}
                disabled={!ok}
                title={
                  ok
                    ? undefined
                    : needs === "image"
                      ? `${MODELS[id].label} is text-to-video only.`
                      : `${MODELS[id].label} needs a starting image.`
                }
                className={`rounded-full px-3 py-1 ${
                  model === id
                    ? "bg-accent text-accent-ink"
                    : ok
                      ? "text-muted"
                      : "cursor-not-allowed text-muted/40"
                }`}
              >
                {MODELS[id].label}
              </button>
            );
          })}
        </div>

        <label className="flex items-center gap-2">
          <span className="text-muted">Duration</span>
          <input
            type="range"
            min={MIN_DURATION_S}
            max={maxDuration}
            value={Math.min(durationS, maxDuration)}
            onChange={(e) => setDurationS(Number(e.target.value))}
            className="accent-[var(--accent)]"
          />
          <span className="w-8 font-medium">{Math.min(durationS, maxDuration)}s</span>
        </label>

        <label className="flex items-center gap-2">
          <span className="text-muted">Aspect</span>
          <select
            value={aspect}
            onChange={(e) => setAspect(e.target.value)}
            className="rounded-lg border border-line bg-bg px-2 py-1"
          >
            {ASPECT_RATIOS.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={audio}
            onChange={(e) => setAudio(e.target.checked)}
            className="accent-[var(--accent)]"
          />
          <span className="text-muted">Generate audio</span>
        </label>

        <div className="flex items-center gap-1 rounded-full border border-line p-1 text-xs">
          <button
            onClick={() => setMode("upscaled-1080p")}
            className={`rounded-full px-3 py-1 ${
              mode === "upscaled-1080p" ? "bg-accent text-accent-ink" : "text-muted"
            }`}
          >
            1080p upscaled
          </button>
          {canNative && (
            <button
              onClick={() => setMode("native-1080p")}
              className={`rounded-full px-3 py-1 ${
                mode === "native-1080p" ? "bg-accent text-accent-ink" : "text-muted"
              }`}
            >
              1080p native
            </button>
          )}
        </div>
      </div>

      {mode === "upscaled-1080p" ? (
        <p className="mt-2 text-xs text-muted">
          Rendered at 480p, AI-upscaled to 1080p — same length, sharp result,
          a fraction of native cost.
          {!canNative && ` ${MODELS[model].label} has no native 1080p, so this is the only 1080p route.`}
        </p>
      ) : (
        <p className="mt-2 text-xs text-muted">
          Rendered natively at 1080p for maximum fidelity.
        </p>
      )}

      <div className="mt-3 text-xs">
        <button
          type="button"
          onClick={() => setAdvanced((v) => !v)}
          className="text-muted underline-offset-2 hover:underline"
        >
          {advanced ? "Hide advanced" : "Advanced options"}
        </button>
        {advanced && (
          <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-2">
            <label className="flex items-center gap-2">
              <span className="text-muted">Variations</span>
              <select
                value={variations}
                onChange={(e) => setVariations(Number(e.target.value))}
                className="rounded-lg border border-line bg-bg px-2 py-1"
              >
                {Array.from({ length: MAX_VARIATIONS }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2">
              <span className="text-muted">Seed</span>
              <input
                type="number"
                min={0}
                placeholder="random"
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
                disabled={variations > 1}
                className="w-28 rounded-lg border border-line bg-bg px-2 py-1 disabled:opacity-50"
              />
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={cameraFixed}
                onChange={(e) => setCameraFixed(e.target.checked)}
                className="accent-[var(--accent)]"
              />
              <span className="text-muted">Lock camera</span>
            </label>
          </div>
        )}
      </div>

      {error && <p className="mt-3 text-sm text-bad">{error}</p>}

      <div className="mt-4 flex items-center justify-between">
        <div className="text-sm text-muted">
          {q ? (
            <>
              {variations > 1 ? `${variations} videos: ` : "This video: "}
              <span className="font-semibold text-ink">${(q.usd * variations).toFixed(2)}</span>{" "}
              · {(q.credits * variations).toLocaleString()} credits
            </>
          ) : (
            "…"
          )}
        </div>
        <button
          onClick={generate}
          disabled={busy}
          className="rounded-full bg-accent px-6 py-2.5 font-medium text-accent-ink hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Starting…" : "Generate"}
        </button>
      </div>
    </div>
  );
}
