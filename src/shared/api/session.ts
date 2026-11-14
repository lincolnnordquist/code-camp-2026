import { supabase } from "./client";
import { check } from "./errors";

let signingIn: Promise<string> | null = null;

// The id of the signed-in user, signing the browser in anonymously first when there is no
// session (the attendee's first order). Calls made at the same moment share one sign-in,
// so one browser never ends up with two anonymous users.
export async function ensureSession(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  if (data.session) return data.session.user.id;

  signingIn ??= supabase.auth
    .signInAnonymously()
    .then((result) => check(result).user!.id)
    .finally(() => {
      signingIn = null;
    });
  return signingIn;
}

// The signed-in user's id, or null. Never signs anyone in.
export async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}
