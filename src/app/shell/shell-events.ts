export const OPEN_OFFICIAL_REVIEW_EVENT = "vira:shell:open-official-review";
export const SHELL_OVERLAY_STATE_EVENT = "vira:shell:overlay-state";

export function openOfficialReview() {
  window.dispatchEvent(new Event(OPEN_OFFICIAL_REVIEW_EVENT));
}

export function setShellOverlayState(id: string, open: boolean) {
  window.dispatchEvent(new CustomEvent(SHELL_OVERLAY_STATE_EVENT, { detail: { id, open } }));
}
