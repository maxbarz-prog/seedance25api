<!-- MOVED OUT OF THE REPOSITORY ROOT, 2026-09-10.

     This was README.md. It is a GitHub *profile* README marketing reAPI's
     Seedance API gateway — a different product from the application in this
     repository, and unrelated to Remerged. It arrived in the first two
     commits and sat at the root until the application code was merged to
     main, where it misled anyone opening the repo about what this is.

     Kept rather than deleted: it is finished copy someone may still want,
     and the profile repo it belongs in is seedance25api/seedance25api, not
     this one. Move it there if it is still wanted. -->

## Hi there 👋

<!--
**seedance25api/seedance25api** is a ✨ _special_ ✨ repository because its `README.md` (this file) appears on your GitHub profile.

Here are some ideas to get you started:

- 🔭 I’m currently working on ...
- 🌱 I’m currently learning ...
- 👯 I’m looking to collaborate on ...
- 🤔 I’m looking for help with ...
- 💬 Ask me about ...
- 📫 How to reach me: ...
- 😄 Pronouns: ...
- ⚡ Fun fact: ...
-->


<!-- GitHub profile README for github.com/seedance25api (org profile repo
     seedance25api/seedance25api). Developer-facing, promotes the reAPI
     Seedance pages ONLY (no seedance25ai.im — user said unrelated).
     Facts verified 2026-07-31 against reapi.ai/models/seedance-2-5 (marked
     "Coming soon", per-second credits, four variants, one request shape) and
     reapi.ai/models/seedance-2-0 (live: 4-15s, 480p-4K, ≤4000-char prompt,
     from $0.041/s, 1 credit = $0.001, refund on failure). -->

<div align="center">

# Seedance 2.5 API

**Text, photo, video & audio in — short video out.**

ByteDance's next-generation Seedance 2.5 video model, coming to
[reAPI](https://reapi.ai/models) as an async, OpenAI-style endpoint —
same request shape the [Seedance 2.0 API](https://reapi.ai/models/seedance-2-0)
runs on today.

[**Seedance 2.5 →**](https://reapi.ai/models/seedance-2-5) · [Seedance 2.0 (live)](https://reapi.ai/models/seedance-2-0) · [All models](https://reapi.ai/models) · [Docs](https://reapi.ai/docs)

</div>

---

## What the Seedance API does

- **Every input mode in one endpoint** — text-to-video, image-to-video, first/last frame, reference video, and reference audio.
- **Real people, lip-synced** — the `face` variants combine a reference video with audio to animate real people speaking: voiceovers, explainers, character animation in one call.
- **Continuous chaining** — set `return_last_frame` and feed the returned frame URL into the next call to chain clips without re-prompting.
- **Per-second credit pricing** — 1 credit = $0.001. Seedance 2.0 starts at $0.041/s; failed jobs are refunded automatically.

## Quick start (runs today on Seedance 2.0)

Seedance 2.5 will ship on the same request shape, so code written against
Seedance 2.0 migrates by swapping the model id.

```bash
# 1. Submit a video task
curl https://reapi.ai/api/v1/videos/generations \
  -H "Authorization: Bearer $REAPI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "doubao-seedance-2.0",
    "prompt": "A barista pours latte art in slow motion, warm cafe lighting, cinematic 35mm look",
    "duration": 5,
    "resolution": "720p"
  }'
# → {"id": "task_..."}

# 2. Poll until status is "completed", then read output.video_urls
curl https://reapi.ai/api/v1/tasks/task_xxx \
  -H "Authorization: Bearer $REAPI_API_KEY"
```

Get a key from the [reAPI dashboard](https://reapi.ai) — free credits on
signup, no card required.

## Model variants

| Model id | What it's for |
|---|---|
| `doubao-seedance-2.0` | Standard quality, up to 1080p |
| `doubao-seedance-2.0-fast` | Faster, cheaper renders |
| `doubao-seedance-2.0-face` | Real-person / lip-sync inputs, up to 4K |
| `doubao-seedance-2.0-fast-face` | Fast tier of the face variant |

All four share one request shape: 4–15s clips, 480p–4K, prompts up to 4,000
characters, optional generated audio, aspect ratios from 21:9 to 9:16 plus
`adaptive`. Try them in the [playground](https://reapi.ai/models/seedance-2-0)
without writing code.

## Seedance 2.5 status

The [Seedance 2.5 page](https://reapi.ai/models/seedance-2-5) is live with
positioning, pricing model, and use cases; the API itself is **coming soon**.
Sign up now and your free credits will cover your first Seedance 2.5
generations at launch.

---

<sub>This is a developer resource for the Seedance API on reAPI, an independent
API gateway. Not affiliated with, endorsed by, or sponsored by ByteDance.
Model names belong to their respective owners.</sub>

