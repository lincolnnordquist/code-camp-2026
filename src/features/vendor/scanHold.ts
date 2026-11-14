// FR-30: what a scanned QR means for pickup. The attendee's pickup QR holds the 4-digit code and
// nothing else, so anything else is not a pickup code.
export function pickupCodeFromScan(payload: unknown): string | null {
  if (typeof payload !== "string") return null;
  const code = payload.trim();
  return /^\d{4}$/.test(code) ? code : null;
}

// The camera reports a code in view many times a second, and staff keep the phone up after a
// result. One scan must run one lookup, so a code that was just used is ignored until it has been
// out of view for a moment, or for at most a while however long it stays in view.
export const SAME_CODE_GONE_MS = 2_000;
export const SAME_CODE_HOLD_MAX_MS = 20_000;

export type ScanHold = { code: string; startedAt: number; lastSeenAt: number } | null;

export type ScanFrame =
  // A new pickup code: run the lookup.
  | { kind: "code"; code: string; hold: ScanHold }
  // A QR that is not a pickup code.
  | { kind: "not_pickup"; hold: ScanHold }
  // Nothing new: no QR, or the code that was just used.
  | { kind: "none"; hold: ScanHold };

export function readScanFrame(hold: ScanHold, payload: string | null, now: number): ScanFrame {
  const live = hold && now - hold.lastSeenAt < SAME_CODE_GONE_MS && now - hold.startedAt < SAME_CODE_HOLD_MAX_MS ? hold : null;
  if (payload === null) return { kind: "none", hold: live };
  const code = pickupCodeFromScan(payload);
  if (code === null) return { kind: "not_pickup", hold: live };
  if (live && live.code === code) return { kind: "none", hold: { ...live, lastSeenAt: now } };
  return { kind: "code", code, hold: { code, startedAt: now, lastSeenAt: now } };
}
