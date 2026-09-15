"use client";

// Two small signals between components that do not share a parent.
//
// PLANS: open the plan modal. It is mounted once in the site layout
// (components/PlanModalHost.tsx) and raised from the header, the composer's
// refusal dialog and the welcome offer, so those need a way to say "open"
// without each carrying a copy of it.
//
// PROMPT: put this text in the composer. The example clips under the
// composer are a separate component; clicking one should fill the box.

export const PLANS_EVENT = "remerged:plans";
export const PROMPT_EVENT = "remerged:prompt";
// LOADING: the code is about to navigate (router.push, location.assign).
// A link click is caught by the loader itself; this is for the rest.
export const LOADING_EVENT = "remerged:loading";
// And the other way: a navigation that was announced and then did not
// happen, because the call that was going to make it failed. The loader
// gives up on its own after a few seconds, but an error the person needs to
// read should not wait for that.
export const LOADING_DONE_EVENT = "remerged:loading-done";

export function showLoader() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(LOADING_EVENT));
}

export function hideLoader() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(LOADING_DONE_EVENT));
}

export function openPlans(from: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(PLANS_EVENT, { detail: { from } }));
}

export function setComposerPrompt(text: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(PROMPT_EVENT, { detail: { text } }));
}
