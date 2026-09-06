"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ASPECT_RATIOS,
  DEFAULT_DURATION_S,
  MAX_DURATION_S,
  MAX_PROMPT_CHARS,
  MIN_DURATION_S,
} from "@/lib/config";

interface Quote {
  credits: number;
  usd: number;
  perSecUsd: number;
}

const DRAFT_KEY = "remerge-draft";

export default function Composer() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [durationS, setDurationS] = useState(DEFAULT_DURATION_S);
  const [aspect, setAspect] = useState<string>("16:9");
  const [audio, setAudio] = useState(false);
  const [mode, setMode] = useState<"upscaled-1080p" | "native-1080p">("upscaled-1080p");
  const [q, setQ] = useState<Quote | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Draft survives the signup/membership/top-up detour.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d.prompt) setPrompt(d.prompt);
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
        JSON.stringify({ prompt, durationS, aspect, audio, mode })
      );
    } catch {}
  }, [prompt, durationS, aspect, audio, mode]);

  useEffect(() => {
    const ctl = new AbortController();
    fetch(`/api/quote?duration=${durationS}&mode=${mode}`, { signal: ctl.signal })
      .then((r) => r.json())
      .then(setQ)
      .catch(() => {});
    return () => ctl.abort();
  }, [durationS, mode]);

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
          durationS,
          aspect,
          audio,
          mode,
          upscaleFactor: 2,
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
      router.push(`/jobs/${data.id}`);
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
      <div className="mt-1 text-right text-xs text-muted">
        {prompt.length}/{MAX_PROMPT_CHARS}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
        <label className="flex items-center gap-2">
          <span className="text-muted">Duration</span>
          <input
            type="range"
            min={MIN_DURATION_S}
            max={MAX_DURATION_S}
            value={durationS}
            onChange={(e) => setDurationS(Number(e.target.value))}
            className="accent-[var(--accent)]"
          />
          <span className="w-8 font-medium">{durationS}s</span>
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
          Rendered at 480p, AI-upscaled to 1080p — same length, sharp result, a
          fraction of native cost.
        </p>
      ) : (
        <p className="mt-2 text-xs text-muted">
          Rendered natively at 1080p. Maximum fidelity, priced at what native
          rendering costs.
        </p>
      )}

      {error && <p className="mt-3 text-sm text-bad">{error}</p>}

      <div className="mt-4 flex items-center justify-between">
        <div className="text-sm text-muted">
          {q ? (
            <>
              This video:{" "}
              <span className="font-semibold text-ink">${q.usd.toFixed(2)}</span>{" "}
              · {q.credits.toLocaleString()} credits — exactly our cost
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
