"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ASPECT_RATIOS,
  DEFAULT_DURATION_S,
  DEFAULT_MODEL,
  IMAGE_ROLES,
  ImageRole,
  MAX_IMAGES,
  MAX_PROMPT_CHARS,
  MAX_VARIATIONS,
  MIN_DURATION_S,
  MODELS,
  ModelId,
} from "@/lib/config";

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
  const [uploadsEnabled, setUploadsEnabled] = useState(false);
  const [images, setImages] = useState<{ key: string; preview: string; role: ImageRole }[]>([]);
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

  async function addImages(files: FileList | null) {
    if (!files || !files.length) return;
    setError(null);
    setUploading(true);
    try {
      for (const file of Array.from(files).slice(0, MAX_IMAGES - images.length)) {
        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
          setError("Use JPEG, PNG or WebP images.");
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
          setError("Images must be under 10 MB.");
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
            preview: URL.createObjectURL(file),
            // First image defaults to "first frame" (image-to-video); later
            // ones are free references.
            role: prev.length === 0 ? "first_frame" : "reference",
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
        if (d.model && d.model in MODELS) setModel(d.model);
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
    const ctl = new AbortController();
    fetch(`/api/quote?model=${model}&duration=${Math.min(durationS, maxDuration)}&mode=${mode}`, {
      signal: ctl.signal,
    })
      .then((r) => r.json())
      .then(setQ)
      .catch(() => {});
    return () => ctl.abort();
  }, [model, durationS, mode, maxDuration]);

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
        router.push(data.error === "membership_required" ? "/account?join=1" : "/account?topup=1");
        return;
      }
      if (!res.ok) {
        setError(data.message || data.error || "Something went wrong.");
        return;
      }
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {}
      router.push(variations > 1 ? "/library" : `/jobs/${data.id}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value.slice(0, MAX_PROMPT_CHARS))}
        placeholder="A barista pours latte art in slow motion, warm cafe lighting, cinematic 35mm look…"
        rows={4}
        className="w-full resize-y rounded-xl border border-line bg-bg p-4 text-base outline-none focus:border-accent"
      />
      <div className="mt-1 flex items-center justify-between text-xs text-muted">
        <div className="flex items-center gap-2">
          {uploadsEnabled && images.length < MAX_IMAGES && (
            <label className="cursor-pointer rounded-full border border-line px-3 py-1 hover:border-accent">
              {uploading ? "Uploading…" : "+ Reference image"}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                className="hidden"
                onChange={(e) => addImages(e.target.files)}
              />
            </label>
          )}
          {images.map((img) => (
            <span key={img.key} className="relative inline-flex items-center gap-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.preview} alt="" className="h-10 w-10 rounded-lg object-cover" />
              <select
                value={img.role}
                onChange={(e) =>
                  setImages((prev) =>
                    prev.map((i) => (i.key === img.key ? { ...i, role: e.target.value as ImageRole } : i))
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
          {(Object.values(MODELS) as (typeof MODELS)[ModelId][]).map((m) => (
            <button
              key={m.id}
              onClick={() => setModel(m.id)}
              className={`rounded-full px-3 py-1 ${
                model === m.id ? "bg-accent text-accent-ink" : "text-muted"
              }`}
            >
              {m.label}
            </button>
          ))}
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
          <button
            onClick={() => setMode("native-1080p")}
            className={`rounded-full px-3 py-1 ${
              mode === "native-1080p" ? "bg-accent text-accent-ink" : "text-muted"
            }`}
          >
            1080p native
          </button>
        </div>
      </div>

      {mode === "upscaled-1080p" ? (
        <p className="mt-2 text-xs text-muted">
          Rendered at 480p, AI-upscaled to 1080p — same length, sharp result,
          a fraction of native cost.
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
