import { User } from "./db";

// The welcome flow: three short steps between the account existing and the
// composer, then one upgrade offer, once.
//
//   1. Finalize   agree to the Terms, acknowledge the Privacy Policy
//   2. Referral   a code, or Skip
//   3. Survey     who they are, what they came for, how they heard of us
//
// The answers live on the user row, one field per step, so the flow resumes
// where it stopped and never runs twice. Accounts made before the flow
// existed are left alone: the date below is when it shipped.

export const ONBOARDING_SINCE = Date.UTC(2026, 8, 14);

export type Step = "finalize" | "referral" | "survey" | "done";

export function nextStep(user: Pick<User, "terms_accepted_at" | "referral_answered_at" | "onboarded_at">): Step {
  if (user.onboarded_at) return "done";
  if (!user.terms_accepted_at) return "finalize";
  if (!user.referral_answered_at) return "referral";
  return "survey";
}

export function needsOnboarding(
  user: Pick<User, "created_at" | "terms_accepted_at" | "referral_answered_at" | "onboarded_at"> | null
): boolean {
  if (!user) return false;
  if (user.created_at < ONBOARDING_SINCE) return false;
  return nextStep(user) !== "done";
}

// The survey. Keys are what gets stored and reported on; labels are what
// people read. Adding an option is adding a line here.
export const SURVEY = {
  role: {
    question: "What best describes you?",
    options: [
      { key: "creator", label: "Content creator", blurb: "Social, YouTube, streams" },
      { key: "marketer", label: "Marketer or agency", blurb: "Ads, product, campaigns" },
      { key: "filmmaker", label: "Filmmaker", blurb: "Shorts, previs, music video" },
      { key: "developer", label: "Developer or founder", blurb: "Building something with video" },
      { key: "exploring", label: "Just exploring", blurb: "Curious what it can do" },
      { key: "other", label: "Other", blurb: "Not listed here" },
    ],
  },
  goal: {
    question: "What are you looking for?",
    options: [
      { key: "editing", label: "The best editing experience", blurb: "Control, quality, iteration" },
      { key: "price", label: "The cheapest price", blurb: "The most video for the money" },
    ],
  },
  source: {
    question: "How did you hear about us?",
    options: [
      { key: "linkedin", label: "LinkedIn", blurb: "" },
      { key: "reddit", label: "Reddit", blurb: "" },
      { key: "facebook", label: "Facebook", blurb: "" },
      { key: "youtube", label: "YouTube", blurb: "" },
      { key: "ai_chat", label: "ChatGPT / AI chat", blurb: "" },
      { key: "x", label: "Twitter / X", blurb: "" },
      { key: "word_of_mouth", label: "Word of mouth", blurb: "" },
      { key: "instagram", label: "Instagram", blurb: "" },
      { key: "news", label: "News / podcasts", blurb: "" },
      { key: "tiktok", label: "TikTok", blurb: "" },
      { key: "google", label: "Google", blurb: "" },
      { key: "other", label: "Other", blurb: "" },
    ],
  },
} as const;

export type SurveyQuestion = keyof typeof SURVEY;

export function surveyOption(q: SurveyQuestion, key: string): boolean {
  return (SURVEY[q].options as readonly { key: string }[]).some((o) => o.key === key);
}
