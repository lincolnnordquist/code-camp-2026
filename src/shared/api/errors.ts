// A network or server failure is thrown, so a screen shows its error state. Only an answer
// from our own functions (a typed refusal) is returned as a result.
export function check<T>(
  result: { data: T | null; error: { message: string } | null },
  options: { allowEmpty: true },
): T | null;
export function check<T>(result: {
  data: T | null;
  error: { message: string } | null;
}): T;
export function check<T>(
  result: { data: T | null; error: { message: string } | null },
  options?: { allowEmpty: boolean },
): T | null {
  if (result.error) throw new Error(result.error.message);
  if (result.data === null && !options?.allowEmpty) {
    throw new Error("The server sent no data");
  }
  return result.data;
}

// A reply from one of our database or Edge Functions: ok, or a refusal with a reason.
export type Reply = {
  ok: boolean;
  reason?: string;
  productIds?: string[];
  at?: string;
};

// A refusal as the typed result, or a thrown error for a reason the app does not know.
export function refusal<R extends string>(
  reply: Reply,
  allowed: readonly R[],
): { ok: false; reason: R; productIds?: string[]; at?: string } {
  const reason = reply.reason as R;
  if (!allowed.includes(reason)) {
    throw new Error(`Unexpected refusal: ${reply.reason}`);
  }
  return {
    ok: false,
    reason,
    ...(reply.productIds ? { productIds: reply.productIds } : {}),
    ...(reply.at ? { at: reply.at } : {}),
  };
}
