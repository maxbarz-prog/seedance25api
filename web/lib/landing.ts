// The showcase clips on the landing page, and the prompts that made them.
//
// One list, read by two things: the page, which draws a <video> per entry
// from /landing/<file>, and scripts/landing-showcase.mjs, which renders the
// entries that are missing. The prompts are shown under the clips — the
// page is the product demonstrating itself, and a visitor should be able to
// paste one into the composer and get the same thing.
//
// Files land in web/public/landing/ from the showcase workflow: a 1080p
// web encode (<file>.mp4), a poster (<file>.jpg), and the prompt that made
// it. Until a file exists the poster's absence is handled by the page — a
// gradient in place of a clip, not a broken player.

export interface ShowcaseClip {
  file: string;
  title: string;
  prompt: string;
  // The route the clip was rendered on. The hero is the one that fills the
  // screen, so it gets the native render; the rest are 720p renders
  // upscaled to 4K, which is the route most members will actually pick.
  quality: "1080p" | "720p";
  durationS: number;
  // Which slot the page puts it in.
  slot: "hero" | "card";
}

export const SHOWCASE: readonly ShowcaseClip[] = [
  {
    file: "hero",
    title: "Text to video",
    prompt:
      "A hummingbird hovers at a red trumpet flower in golden late-afternoon light, wings a soft blur, dew on the petals catching the sun. Macro lens, shallow depth of field, slow motion, the camera drifting gently sideways.",
    quality: "1080p",
    durationS: 4,
    slot: "hero",
  },
  {
    file: "city",
    title: "Cinematic motion",
    prompt:
      "A rain-soaked street in Tokyo at night, neon signs reflecting in puddles, a lone figure with a clear umbrella walking away from camera. Slow dolly forward, anamorphic lens flares, cinematic colour grade.",
    quality: "720p",
    durationS: 4,
    slot: "card",
  },
  {
    file: "ocean",
    title: "Natural detail",
    prompt:
      "A turquoise ocean wave curling and breaking in slow motion at sunrise, backlit spray glowing gold, fine droplets hanging in the air. Low angle from the water surface, telephoto lens.",
    quality: "720p",
    durationS: 4,
    slot: "card",
  },
  {
    file: "studio",
    title: "Product shots",
    prompt:
      "A matte black wireless headphone rotating slowly on a dark reflective surface, a single soft studio light sweeping across it, fine dust particles drifting in the beam. Clean product cinematography, 4K commercial look.",
    quality: "720p",
    durationS: 4,
    slot: "card",
  },
];

export const SHOWCASE_MODEL = "seedance-2.5";

// Who else runs on the same model. Seedance is ByteDance's, and it is the
// engine behind their own editors as well as a handful of well-known
// platforms that resell it. Names only — these are other people's marks,
// and none of them has endorsed us; the line above the row says exactly
// what the relationship is.
export const SEEDANCE_ALSO_POWERS: readonly string[] = [
  "CapCut",
  "Dreamina",
  "Jimeng",
  "BytePlus",
  "fal",
  "Replicate",
  "Freepik",
  "Krea",
  "Higgsfield",
  "WaveSpeed",
];
