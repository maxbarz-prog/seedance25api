"use client";

import { useEffect, useMemo, useState } from "react";
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
  OUTPUT_MODES,
  OutputMode,
  QUALITIES,
  QUALITY_IDS,
  Quality,
  qualitiesForModel,
  UPSCALES,
  UPSCALE_IDS,
  Upscale,
  DEFAULT_QUALITY,
  DEFAULT_UPSCALE,
} from "@/lib/config";
import CreditsDialog, { CreditsBlock } from "./CreditsDialog";
import { PricingConstants, quoteWith } from "@/lib/pricing";
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

export default function Composer({
  pricing,
  uploadsEnabled,
}: {
  // Handed down from the server so a price change needs no network call.
  pricing: PricingConstants;
  uploadsEnabled: boolean;
}) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState<ModelId>(DEFAULT_MODEL);
  const [durationS, setDurationS] = useState(DEFAULT_DURATION_S);
  const [aspect, setAspect] = useState<string>("16:9");
  const [audio, setAudio] = useState(false);
  // Quality and upscale are two independent choices; `mode` is just the pair
  // of them, and the only thing the API is told.
  const [quality, setQuality] = useState<Quality>(DEFAULT_QUALITY);
  const [upscale, setUpscale] = useState<Upscale>(DEFAULT_UPSCALE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [block, setBlock] = useState<CreditsBlock | null>(null);
  const [images, setImages] = useState<
    { key: string; preview: string; role: InputRole; name: string }[]
  >([]);
  const [uploading, setUploading] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [seed, setSeed] = useState<string>("");
  const [cameraFixed, setCameraFixed] = useState(false);
  const [variations, setVariations] = useState(1);

  const maxDuration = MODELS[model].maxDurationS;

  const imageCount = images.filter((i) => !i.role.startsWith("reference_")).length;
  const videoCount = images.filter((i) => i.role === "reference_video").length;
  const audioCount = images.filter((i) => i.role === "reference_audio").length;

  // Some models take only one kind of prompt (the lite pair is split into a
  // text-to-video and an image-to-video build), so the model list has to
  // follow what has actually been attached.
  const needs: "text" | "image" = imageCount > 0 ? "image" : "text";
  const compatible = (m: ModelId) =>
    (MODELS[m].accepts as readonly string[]).includes(needs);
  // Which render qualities this model actually offers. 2.0 Fast and 2.0 Mini
  // have no 1080p output at the provider, so it is not shown for them.
  const qualities = qualitiesForModel(model);
  const qualityOk = qualities.includes(quality);
  // Upscaling 1080p to 1080p is a no-op, so it is not a route.
  const upscales = UPSCALE_IDS.filter((u) => !(quality === "1080p" && u === "1080p"));
  const upscaleOk = upscales.includes(upscale);
  const mode: OutputMode = `${qualityOk ? quality : DEFAULT_QUALITY}${
    (upscaleOk ? upscale : DEFAULT_UPSCALE) === "none" ? "" : `-${upscaleOk ? upscale : DEFAULT_UPSCALE}`
  }`;
  // A supplied first or last frame fixes the output ratio at the provider, so
  // offering an aspect choice alongside one would be a lie.
  const framePinned = images.some(
    (i) => i.role === "first_frame" || i.role === "last_frame"
  );

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
        if (d.quality && QUALITY_IDS.includes(d.quality)) setQuality(d.quality);
        if (d.upscale && UPSCALE_IDS.includes(d.upscale)) setUpscale(d.upscale);
      }
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({ prompt, model, durationS, aspect, audio, quality, upscale })
      );
    } catch {}
  }, [prompt, model, durationS, aspect, audio, quality, upscale]);

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

  // Switching to a model that cannot render the chosen quality, or to 1080p
  // with the 1080p upscale selected, falls back rather than showing a price
  // for something that cannot be ordered.
  useEffect(() => {
    if (!qualityOk) setQuality(DEFAULT_QUALITY);
    if (!upscaleOk) setUpscale(DEFAULT_UPSCALE);
     
  }, [qualityOk, upscaleOk]);

  // Priced here, not over the network. The formula is arithmetic over the
  // model registry plus a handful of constants the server handed down, so a
  // change to the model, length or output route repaints immediately. The
  // server re-quotes before it charges anyone, so this is a display, never
  // the authority.
  const q: Quote | null = useMemo(() => {
    try {
      return quoteWith(pricing, {
        model,
        durationS: Math.min(durationS, maxDuration),
        mode,
        audio,
      });
    } catch {
      return null;
    }
     
  }, [pricing, model, durationS, maxDuration, mode, audio]);

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
            data.error === "membership_required" || data.error === "plan_required"
              ? "plan_required"
              : "insufficient_credits",
          needed: data.needed,
          balance: data.balance,
          canBuyCredits: data.canBuyCredits,
          message: data.message,
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
            disabled={framePinned}
            title={
              framePinned
                ? "A first or last frame sets the aspect — the video matches your image."
                : undefined
            }
            className="rounded-lg border border-line bg-bg px-2 py-1 disabled:opacity-50"
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

        {/* Two separate decisions: what the model renders, and what happens
            to it afterwards. Conflating them into one list of routes hid the
            fact that the render is the expensive half. */}
        <div className="flex items-center gap-2">
          <span className="text-muted">Quality</span>
          <div className="flex items-center gap-1 rounded-full border border-line p-1">
            {qualities.map((qq) => (
              <button
                key={qq}
                onClick={() => setQuality(qq)}
                className={`rounded-full px-3 py-1 ${
                  quality === qq ? "bg-accent text-accent-ink" : "text-muted"
                }`}
              >
                {QUALITIES[qq].label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-muted">Upscale</span>
          <div className="flex items-center gap-1 rounded-full border border-line p-1">
            {upscales.map((uu) => (
              <button
                key={uu}
                onClick={() => setUpscale(uu)}
                className={`rounded-full px-3 py-1 ${
                  upscale === uu ? "bg-accent text-accent-ink" : "text-muted"
                }`}
              >
                {uu === "none" ? "None" : UPSCALES[uu].label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* The pipeline, stated plainly: what gets rendered, at what size, and
          what happens to it afterwards. */}
      <p className="mt-2 text-xs text-muted">
        <span className="font-medium text-ink">
          {MODELS[model].label} at {OUTPUT_MODES[mode].renderedAt}
          {OUTPUT_MODES[mode].native
            ? " — delivered as rendered"
            : ` → AI upscale → ${OUTPUT_MODES[mode].resolution}`}
        </span>
        <br />
        {OUTPUT_MODES[mode].blurb}
        {!qualities.includes("1080p") && (
          <> {MODELS[model].label} does not render 1080p itself, so that quality is not shown.</>
        )}
      </p>

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
