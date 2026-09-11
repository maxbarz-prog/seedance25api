import {
  ANNUAL_DISCOUNT,
  DEFAULT_MODE,
  DEFAULT_MODEL,
  EXTEND_MAX_S,
  EXTEND_MIN_S,
  MAX_DURATION_S,
  MAX_IMAGES,
  MAX_VARIATIONS,
  MIN_DURATION_S,
  MIN_TOPUP_USD,
  MODELS,
  MODEL_IDS,
  OUTPUT_MODES,
  PLANS,
  PLAN_IDS,
  SITE_DOMAIN,
  SITE_NAME,
  planPriceUsd,
  qualitiesForModel,
} from "./config";
import { fmtUsd, quote } from "./pricing";
import { SUPPORT_EMAIL } from "./legal";

// The help centre, as content rather than as pages.
//
// Two rules it exists to obey:
//
// 1. NOTHING HERE IS TYPED IN TWICE. Every price, plan figure, limit and
//    model name is read from the registry at render time, so an article
//    cannot quietly contradict the product. A help centre that says "$0.65"
//    after the price moved is worse than no help centre.
// 2. It answers the question, then says what to do. Support articles that
//    describe the interface without answering anything are the reason people
//    email instead.
//
// Structure follows a conventional help centre — categories of articles,
// searchable, with a way to reach a human — because that is what people
// already know how to use.

export interface HelpBlock {
  kind: "p" | "list" | "table" | "note";
  // p / note
  text?: string;
  // list
  items?: string[];
  // table
  head?: string[];
  rows?: string[][];
}

export interface HelpArticle {
  slug: string;
  title: string;
  // One line, shown under the title in listings and in search results.
  summary: string;
  body: HelpBlock[];
}

export interface HelpCategory {
  slug: string;
  title: string;
  blurb: string;
  articles: HelpArticle[];
}

const p = (text: string): HelpBlock => ({ kind: "p", text });
const note = (text: string): HelpBlock => ({ kind: "note", text });
const list = (...items: string[]): HelpBlock => ({ kind: "list", items });
const table = (head: string[], rows: string[][]): HelpBlock => ({ kind: "table", head, rows });

// ---------- figures pulled from the registry ----------

const usd = (n: number) => `$${n.toFixed(2)}`;
const price = (mode: string, seconds = 5, model = DEFAULT_MODEL) =>
  fmtUsd(quote({ model, durationS: seconds, mode }).usd);
const credits = (mode: string, seconds = 5, model = DEFAULT_MODEL) =>
  quote({ model, durationS: seconds, mode }).credits;

function planRows(): string[][] {
  return PLAN_IDS.map((id) => {
    const plan = PLANS[id];
    return [
      plan.label,
      plan.monthlyUsd === 0 ? "Free" : `${usd(plan.monthlyUsd)}/month`,
      plan.monthlyUsd === 0 ? "—" : `${usd(planPriceUsd(id, "year"))}/year`,
      `${plan.credits.toLocaleString()}${plan.recurring ? " a month" : " once"}`,
      `${plan.storageGb} GB`,
      plan.canBuyCredits ? "Yes" : "No",
    ];
  });
}

function modelRows(): string[][] {
  return MODEL_IDS.map((id) => [
    MODELS[id].label,
    `${MODELS[id].maxDurationS}s`,
    qualitiesForModel(id).join(", "),
    price(DEFAULT_MODE, 5, id),
  ]);
}

function routeRows(): string[][] {
  const model = DEFAULT_MODEL;
  return Object.values(OUTPUT_MODES)
    .filter((m) => qualitiesForModel(model).includes(m.quality))
    .map((m) => [
      m.label,
      m.renderedAt,
      m.resolution,
      price(m.id, 5, model),
      price(m.id, 10, model),
    ]);
}

// How many default clips a plan's monthly allocation buys. The most common
// question about any credit system, and the one nobody answers.
function allocationRows(): string[][] {
  const per = credits(DEFAULT_MODE, 5);
  return PLAN_IDS.map((id) => {
    const n = Math.floor(PLANS[id].credits / per);
    return [
      PLANS[id].label,
      PLANS[id].credits.toLocaleString(),
      `${n} clip${n === 1 ? "" : "s"}`,
    ];
  });
}

// ---------- the articles ----------

export const HELP: HelpCategory[] = [
  {
    slug: "getting-started",
    title: "Getting started",
    blurb: `What ${SITE_NAME} is, and how to make your first video.`,
    articles: [
      {
        slug: "what-is-remerged",
        title: `What ${SITE_NAME} is`,
        summary: "AI video generation sold at cost. The plan is the business model, not the videos.",
        body: [
          p(
            `${SITE_NAME} turns a written description — and optionally a starting image — into a short video. The models are the Seedance family, run through our provider's API.`
          ),
          p(
            "The difference from everywhere else is the pricing. Generation is billed at what it costs us: the provider's charge for that specific render, plus the real cost of storing and delivering the file, plus a stated overhead and payment fees. There is no markup on usage. The plan fee is our revenue, and the price page shows the formula in full."
          ),
          p(
            `That is why a plan's credits go further here. Most of the allocations are deliberately the same numbers Runway uses, so the two can be compared directly: the same ${PLANS.standard.credits.toLocaleString()} credits on ${PLANS.standard.label} buy several times more video here than they do there.`
          ),
        ],
      },
      {
        slug: "your-first-video",
        title: "Making your first video",
        summary: "Five steps, about a minute of typing and a few minutes of waiting.",
        body: [
          list(
            "Write what you want to see. Describe the subject, what it does, and how the camera behaves. Specific beats poetic.",
            `Pick a length — ${MIN_DURATION_S} to ${MAX_DURATION_S} seconds, depending on the model.`,
            "Leave quality and upscale at their defaults unless you have a reason to change them.",
            "Check the price shown next to the button. It updates as you change anything, and it is what you will be charged.",
            "Press generate. You are taken to the job page, which updates itself until the video is ready."
          ),
          p(
            "Nothing is charged until the job is accepted, and a generation that fails is refunded automatically."
          ),
        ],
      },
      {
        slug: "writing-a-prompt",
        title: "Writing a prompt that works",
        summary: "What to include, what to leave out, and why the model ignored half of it.",
        body: [
          p("A prompt that works usually has four parts, in this order:"),
          list(
            "Subject — who or what is in the shot, described concretely.",
            "Action — one or two things that happen. Not five.",
            "Camera — static, slow push in, handheld, orbit.",
            "Look — lighting, time of day, film stock, colour."
          ),
          p(
            "Models follow the first instructions best. A prompt with five separate actions will reliably produce two or three of them, and which ones varies by model. If you need a specific sequence, generate it in parts and extend."
          ),
          note(
            "Negative phrasing rarely works. \"No people\" often produces people. Describe the scene you do want instead."
          ),
        ],
      },
      {
        slug: "using-an-image",
        title: "Starting from an image",
        summary: `Up to ${MAX_IMAGES} images, as a first frame, a last frame or a style reference.`,
        body: [
          p(
            `You can attach up to ${MAX_IMAGES} images. Each has a role: a first frame is where the video begins, a last frame is where it ends, and a reference guides style without fixing any particular frame.`
          ),
          p(
            "A first or last frame fixes the output's aspect ratio to that image's — the provider takes the ratio from the image and rejects any other — so the aspect control is hidden when you attach one. That is not a bug; it is the only ratio that render can produce."
          ),
          note(
            "The provider refuses photographs of real people. Any image that reads as a real person's face will be rejected at submission with \"may contain real person\", and nothing is charged. Describe the person in the prompt instead, or use a clearly synthetic image."
          ),
        ],
      },
    ],
  },

  {
    slug: "creating",
    title: "Creating",
    blurb: "Models, quality, upscaling, length, extending and everything else on the composer.",
    articles: [
      {
        slug: "quality-and-upscale",
        title: "Quality and upscale — what to pick",
        summary: "Two separate choices. The default is the best value, and it is not a compromise.",
        body: [
          p(
            "Quality is what the model renders. Upscale is what happens to that render afterwards. They are separate because they cost very differently: the render dominates the bill, so buying resolution at the upscaler is far cheaper than rendering it."
          ),
          p(`For a 5 and 10 second clip on ${MODELS[DEFAULT_MODEL].label}:`),
          table(["Route", "Rendered at", "Delivered", "5s", "10s"], routeRows()),
          p(
            `That is why the default is ${OUTPUT_MODES[DEFAULT_MODE].label}: it delivers 3840×2160 for less than a native 1080p render costs, because the expensive part — the model — is doing less work.`
          ),
          p(
            "When native 1080p is worth it: the upscaler infers detail that was not in the 480p render, and on fine texture, small faces and dense foliage that inference can look synthetic. A native render has no interpolated detail. You are paying several times more for that honesty."
          ),
        ],
      },
      {
        slug: "choosing-a-model",
        title: "Which model to use",
        summary: `${MODEL_IDS.length} models, from cheapest to most capable.`,
        body: [
          table(
            ["Model", "Max length", "Renders at", `${OUTPUT_MODES[DEFAULT_MODE].label}, 5s`],
            modelRows()
          ),
          p(
            "Higher-numbered models follow instructions more reliably and hold detail better; the Fast and Mini builds trade some of that for price. If you are iterating on a prompt, iterate on a cheap model and do the final render on an expensive one — the prompt behaviour is similar enough to be useful."
          ),
          p(
            "Only some models render 1080p themselves. Where a model does not, that quality is not offered for it, and its route list on the composer is shorter."
          ),
        ],
      },
      {
        slug: "length-and-variations",
        title: "Length, seeds and variations",
        summary: `${MIN_DURATION_S}–${MAX_DURATION_S} seconds, up to ${MAX_VARIATIONS} at once.`,
        body: [
          p(
            `Length runs from ${MIN_DURATION_S} to ${MAX_DURATION_S} seconds, capped per model. Price is close to linear in length, because the provider bills per frame.`
          ),
          p(
            `Variations generate up to ${MAX_VARIATIONS} clips from the same prompt in one go, each with a different random seed. You are charged for each.`
          ),
          p(
            "A seed makes a render repeatable: the same prompt, model, length and seed produce the same video. Set one when you want to change a single word and see only that word's effect. A fixed seed with several variations would produce identical clips, so the two cannot be combined."
          ),
        ],
      },
      {
        slug: "extending-a-clip",
        title: "Extending a video",
        summary: `Add ${EXTEND_MIN_S}–${EXTEND_MAX_S} seconds to a finished clip.`,
        body: [
          p(
            `Any finished video can be continued. The end of the existing clip is sent to the model as a reference, and it renders what comes next.`
          ),
          note(
            "An extension returns only the new seconds — it is a separate video, not a longer version of the original. Both stay in your library."
          ),
          p(
            "An extension costs a little more per second than a fresh render of the same length, because the provider bills the reference footage as input. The price shown before you confirm already includes that."
          ),
        ],
      },
      {
        slug: "storage-and-downloads",
        title: "Your library, storage and downloads",
        summary: "Where finished videos live and how long they stay.",
        body: [
          p(
            "Every finished video is in your library. Download it from there or from its job page; the file is yours to use under the terms."
          ),
          table(
            ["Plan", "Storage"],
            PLAN_IDS.map((id) => [PLANS[id].label, `${PLANS[id].storageGb} GB`])
          ),
          p(
            "A generation is refused if it would take you over your quota, before you are charged. Delete videos you have downloaded to free space, or move to a plan with more."
          ),
        ],
      },
    ],
  },

  {
    slug: "plans-billing-credits",
    title: "Plans, billing and credits",
    blurb: "What each plan includes, how credits work, and what a video actually costs.",
    articles: [
      {
        slug: "plans",
        title: "The plans",
        summary: `${PLAN_IDS.length} plans. ${Math.round(ANNUAL_DISCOUNT * 100)}% off if you pay yearly.`,
        body: [
          table(
            ["Plan", "Monthly", "Yearly", "Credits", "Storage", "Can buy credits"],
            planRows()
          ),
          p(
            `Every plan can generate and every plan can upscale — ${PLANS.free.label} included. What limits you is credits and storage, not a feature list.`
          ),
          p(
            `Paying yearly costs ${Math.round(ANNUAL_DISCOUNT * 100)}% less per month. Credits are still granted monthly on a yearly plan: paying up front buys a cheaper month, not a year of credits to spend on day one.`
          ),
        ],
      },
      {
        slug: "how-credits-work",
        title: "How credits work",
        summary: "1 credit = 1 cent. Plan credits expire; credits you buy do not.",
        body: [
          p(
            "A credit is one US cent of generation. Every video is quoted in credits before you confirm, and that quote is what is deducted."
          ),
          p("What your plan's monthly credits buy, in default 5-second clips:"),
          table(["Plan", "Credits", `5s ${OUTPUT_MODES[DEFAULT_MODE].label} clips`], allocationRows()),
          p("There are two kinds of credit in your balance, and they behave differently:"),
          list(
            "Credits included with your plan EXPIRE when the plan's period renews, except where your plan carries some over. They are an allowance, not a bank.",
            "Credits you BUY never expire."
          ),
          p(
            "Spending takes the plan credits first, so the credits you paid for are the ones that survive. Your account page shows the split, and an expiry appears in your history as its own line so you can see exactly what lapsed and when."
          ),
          note(
            "Changing plan never forfeits credits. Moving from one plan to another carries everything across; only a renewal expires an unused allowance."
          ),
        ],
      },
      {
        slug: "what-a-video-costs",
        title: "What a video costs, and why",
        summary: "The whole formula, with every term named.",
        body: [
          p("Every generation price on the site comes from one formula:"),
          p("price = (provider + delivery) × (1 + operations) ÷ (1 − processing)"),
          list(
            "provider — what our AI providers charge us for that specific render, derived from the tokens they bill rather than from a price list we maintain",
            "delivery — storage and CDN for the finished file",
            "operations — hosting, admin and support",
            "processing — payment fees, which is why it divides rather than multiplies"
          ),
          p(
            "The provider bills tokens, and tokens are frames × width × height ÷ 1024. That is why a longer clip costs proportionally more, why a higher render quality costs a lot more, and why the same nominal resolution can cost slightly different amounts on different models — they do not all emit the same frame size."
          ),
          p(
            "The pricing page carries a live table for every model and route. It is generated from the same code that charges you."
          ),
        ],
      },
      {
        slug: "buying-credits",
        title: "Buying more credits",
        summary: `Top-ups from ${usd(MIN_TOPUP_USD)}. Needs a paid plan.`,
        body: [
          p(
            `If you run out before your next allocation, top up from your account page. The minimum is ${usd(MIN_TOPUP_USD)} — below that, most of the charge is card processing fees.`
          ),
          p(
            `Top-ups need a paid plan. The ${PLANS.free.label} plan has no card on file and its allocation is the whole offer; to buy credits, move to a paid plan first.`
          ),
          p("Bought credits never expire, and they are spent only after your plan credits are gone."),
        ],
      },
      {
        slug: "changing-or-cancelling",
        title: "Changing or cancelling your plan",
        summary: "Through the billing portal, any time. Access runs to the end of the period.",
        body: [
          p(
            "Use \"Manage subscription\" on your account page. It opens our payment processor's portal, where you can change plan, update the card, or cancel."
          ),
          p(
            "Cancelling keeps your access until the end of the period you have already paid for. After that the account moves to the free plan — you keep your library within the free storage quota, and you keep any credits you bought."
          ),
        ],
      },
      {
        slug: "refunds",
        title: "Refunds",
        summary:
          "Failed generations: automatic. Plan fees: never. Bought credits: yes, less costs.",
        body: [
          p(
            "A generation that fails is refunded to your balance automatically, in full, without you having to ask. It appears in your history as a refund. We also reconcile the other way: if money was taken and the work was never done, we find it and refund it even if nobody reported it."
          ),
          p("Beyond that there are two rules, and they are different:"),
          table(
            ["", "Refundable?"],
            [
              ["Plan fees", "No — you get the rest of the period instead"],
              ["Credits you bought, unspent", "Yes, less the card fee"],
              ["Credits you bought, already spent", "No"],
              ["Credits included with your plan", "No — never purchased"],
            ]
          ),
          p(
            "PLAN FEES are not refunded. What you get instead is the period you already paid for: cancel your plan or deactivate your account and your access runs to the end of the current billing period before the account moves to Free. Partial periods are not prorated. The exception is a charge made in error — tell us within 14 days and we will refund it in full."
          ),
          p(
            "CREDITS YOU BOUGHT can be refunded to the original card, minus the costs already incurred on them. Two things come off: credits you have already spent, because we paid a provider to render those videos at the moment you made them, and the card processing fee on the original purchase, which our payment processor keeps even when the payment is refunded. So you get back the value of your unused bought credits, less that fee."
          ),
          note(
            "Credits that came with your plan are not refundable at all, in any amount. They were granted rather than bought, so there is no payment behind them to return. Your account page shows which half of your balance is which."
          ),
          p(`To ask for one, email ${SUPPORT_EMAIL} from the address on the account.`),
        ],
      },
    ],
  },

  {
    slug: "account",
    title: "Your account",
    blurb: "Signing in, your details, and deleting things.",
    articles: [
      {
        slug: "signing-in",
        title: "Signing in and password resets",
        summary: "Email and password, or a Google account.",
        body: [
          p(
            "Sign in with the email and password you signed up with, or with Google if that is how the account was created."
          ),
          p(
            "Forgotten password: use the link on the sign-in page. A reset link is emailed to you and expires shortly. If it does not arrive within a few minutes, check spam — and check you are using the address you signed up with."
          ),
        ],
      },
      {
        slug: "your-balance",
        title: "Where to see your balance",
        summary: "Top right of every page, on every screen size.",
        body: [
          p(
            "Your credit balance is in the header on every page, because it is what decides whether the next generation can run. Next to it is a button that takes you where you need to go — to top up if your plan allows it, to the plans if it does not."
          ),
          p(
            "The account page breaks the balance down into plan credits and bought credits, and lists every movement: grants, charges, refunds and expiries."
          ),
        ],
      },
      {
        slug: "deleting",
        title: "Deleting videos",
        summary: "Any time, from the library. Frees the storage immediately.",
        body: [
          p(
            "Delete any video from your library. That frees its storage straight away and cannot be undone, so download anything you want to keep first."
          ),
          p(
            "Deleting a video does not refund the credits it cost — the generation has already been paid for at the provider."
          ),
        ],
      },
      {
        slug: "leaving",
        title: "Cancelling, deactivating or deleting your account",
        summary: "Three different things. Only the last one cannot be undone.",
        body: [
          p(
            "All three are on your account page, under Leaving. They are deliberately separate, because they are not the same decision:"
          ),
          table(
            ["", "Billing", "Your videos", "Reversible"],
            [
              ["Cancel your plan", "Stops at period end", "Kept", "Yes — resubscribe"],
              ["Deactivate", "Stops", "Kept", "Yes — sign in and reactivate"],
              ["Delete account", "Stops", "Erased", "No"],
            ]
          ),
          p(
            "CANCELLING keeps everything and just stops the renewal. Your plan runs to the end of the period you have already paid for — plan fees are not refunded, so that remaining time is yours and worth using — and the account moves to Free after that date. Credits you bought stay; plan credits go when the plan does."
          ),
          p(
            "DEACTIVATING puts the account on hold. Billing stops, nothing generates, and every video stays where it is. The same rule applies: a plan you have paid for still runs to the end of its period, so reactivating before that date costs nothing and gets the remaining time back. Sign back in whenever you like and one click brings it all back."
          ),
          p(
            "DELETING is permanent. Every video is removed from storage and your account, history and credits are erased. We cannot recover it afterwards, which is why it asks you to type your email address first."
          ),
          note(
            `Deleting forfeits every credit in your balance. If any of them were BOUGHT rather than granted with your plan, ask for a refund at ${SUPPORT_EMAIL} BEFORE you delete — once the account is gone there is no record to refund against. Plan fees are not refundable either way; cancelling simply leaves you the rest of the period you paid for.`
          ),
        ],
      },
    ],
  },

  {
    slug: "troubleshooting",
    title: "Troubleshooting",
    blurb: "What went wrong, and what to do about it.",
    articles: [
      {
        slug: "generation-failed",
        title: "My generation failed",
        summary: "You have already been refunded. Here is what usually causes it.",
        body: [
          p(
            "A failed generation is refunded automatically and in full. The job page says what happened in plain language. The common causes:"
          ),
          list(
            "The image looks like a real person. The provider refuses photographs of real people. Use a synthetic image, or describe the person in the prompt with no image at all.",
            "The prompt was rejected by content moderation. Rephrase it.",
            "The model was briefly unavailable or overloaded. Try again; nothing is charged for the failure.",
            "The reference video or audio could not be read. Re-upload it."
          ),
          p(
            `If a job failed and you were not refunded within a few minutes, email ${SUPPORT_EMAIL} with the job link — that is a fault on our side, not yours.`
          ),
        ],
      },
      {
        slug: "not-enough-credits",
        title: "\"Not enough credits\"",
        summary: "What the dialog is telling you and what to do.",
        body: [
          p(
            "The generation would cost more than your balance. The dialog shows the price, your balance and the shortfall."
          ),
          list(
            "On a paid plan: top up, or make the clip shorter, or drop to a cheaper model or route.",
            `On the ${PLANS.free.label} plan: credits cannot be bought, so either wait, use a cheaper route, or move to a paid plan.`
          ),
          p(
            "The cheapest meaningful change is usually the model, then the length, then the route — in that order."
          ),
        ],
      },
      {
        slug: "taking-a-long-time",
        title: "My video is taking a long time",
        summary: "Queued and rendering are different problems.",
        body: [
          p(
            "The job page distinguishes waiting for the provider from actually rendering. A job that says it is queued is waiting for a slot at the provider; one that says it is generating is being rendered."
          ),
          p(
            "Rendering time scales with length and quality, and differs several-fold between models. A 5-second clip is usually a few minutes. Longer, higher quality, or a busy provider can make it considerably more."
          ),
          p(
            "You do not have to keep the tab open. The job continues on our servers and the library shows it when it is done."
          ),
        ],
      },
      {
        slug: "storage-full",
        title: "\"Storage quota reached\"",
        summary: "Delete something, or move to a bigger plan.",
        body: [
          p(
            "Your finished videos add up to your plan's storage limit, and a new generation is refused before you are charged rather than after."
          ),
          p(
            "Download what you want to keep and delete it from the library, or move to a plan with more storage. Deleting frees the space immediately."
          ),
        ],
      },
      {
        slug: "generation-paused",
        title: "\"Generation is paused\"",
        summary: "A deliberate stop, not an outage.",
        body: [
          p(
            "Occasionally the site refuses new generations with a message saying generation is paused. That is a safety measure, not a crash: every finished generation is checked against what the provider actually billed, and if anything is ever charged below what it cost us, selling stops until a human has looked at it."
          ),
          p(
            "Nothing you have paid for is lost — jobs already running finish, and nothing new is charged while the pause is in force. It is normally cleared quickly."
          ),
        ],
      },
    ],
  },

  {
    slug: "policies",
    title: "Policies",
    blurb: "What you may make, what we do with it, and who owns it.",
    articles: [
      {
        slug: "acceptable-use",
        title: "What you may and may not create",
        summary: "The short version of the acceptable use terms.",
        body: [
          p("You may not use the service to create:"),
          list(
            "anything unlawful",
            "sexual content involving minors",
            "non-consensual intimate imagery",
            "deceptive impersonation of real people",
            "harassment",
            "anything that infringes someone else's intellectual property"
          ),
          p(
            "Prompts and outputs pass automated moderation; a rejected generation is refunded. Accounts that violate this are suspended."
          ),
        ],
      },
      {
        slug: "who-owns-the-output",
        title: "Who owns the videos",
        summary: "You do, subject to the model providers' terms.",
        body: [
          p(
            "You keep rights to the prompts and images you upload and to the videos generated for you, subject to the terms of the underlying model providers. We take only the licence needed to process, store and deliver your content."
          ),
          p("We do not use your prompts or outputs to train models."),
        ],
      },
      {
        slug: "ai-disclosure",
        title: "Labelling AI-generated video",
        summary: "Synthetic content, and your obligations when you publish it.",
        body: [
          p(
            `Everything ${SITE_NAME} produces is synthetic, generated by AI from your prompt and inputs.`
          ),
          p(
            "You are responsible for disclosing that where the law or a platform requires it — for example under the EU AI Act's transparency rules — and for not presenting synthetic depictions of real people or events as genuine."
          ),
        ],
      },
    ],
  },

  {
    slug: "contact",
    title: "Contact us",
    blurb: "When the answer is not here.",
    articles: [
      {
        slug: "get-in-touch",
        title: "Getting in touch",
        summary: `Email ${SUPPORT_EMAIL}. Include these details and it will be faster.`,
        body: [
          p(`Email ${SUPPORT_EMAIL}. We read everything.`),
          p("Include whatever applies:"),
          list(
            "the email address on your account",
            "a link to the job, if it is about a specific video",
            "what you expected and what happened instead",
            "for a billing question, the date and amount"
          ),
          p(
            "For anything involving money — a charge you do not recognise, a refund that has not arrived, a balance that looks wrong — say so plainly in the subject line. Those are handled first."
          ),
        ],
      },
    ],
  },
];

export function categoryBySlug(slug: string): HelpCategory | undefined {
  return HELP.find((c) => c.slug === slug);
}

export function articleBySlug(
  categorySlug: string,
  articleSlug: string
): { category: HelpCategory; article: HelpArticle } | undefined {
  const category = categoryBySlug(categorySlug);
  const article = category?.articles.find((a) => a.slug === articleSlug);
  return category && article ? { category, article } : undefined;
}

// Flattened for the client-side search index. Built on the server so the
// browser never has to fetch anything to search — the whole corpus is a few
// kilobytes, which is smaller than one round trip.
export interface HelpIndexEntry {
  category: string;
  categorySlug: string;
  slug: string;
  title: string;
  summary: string;
  // Title, summary and body flattened to one lowercase haystack.
  text: string;
}

export function helpIndex(): HelpIndexEntry[] {
  return HELP.flatMap((c) =>
    c.articles.map((a) => ({
      category: c.title,
      categorySlug: c.slug,
      slug: a.slug,
      title: a.title,
      summary: a.summary,
      text: [
        a.title,
        a.summary,
        ...a.body.flatMap((b) => [
          b.text ?? "",
          ...(b.items ?? []),
          ...(b.head ?? []),
          ...(b.rows ?? []).flat(),
        ]),
      ]
        .join(" ")
        .toLowerCase(),
    }))
  );
}

export const HELP_HOST = `help.${SITE_DOMAIN}`;
