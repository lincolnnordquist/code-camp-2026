import { corsHeaders, json } from "../create-checkout/handler.ts";
import type { OrderEmailSender } from "../_shared/order-email.ts";

export type SendOrderEmailDeps = {
  getUserId(accessToken: string): Promise<string | null>;
  sender: OrderEmailSender;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handleSendOrderEmail(
  request: Request,
  deps: SendOrderEmailDeps,
): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return json(405, { ok: false, reason: "method_not_allowed" });
  }

  const token = request.headers.get("Authorization")?.match(/^Bearer (.+)$/)
    ?.[1];
  const userId = token ? await deps.getUserId(token) : null;
  if (!userId) return json(401, { ok: false, reason: "not_signed_in" });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const orderId = typeof body === "object" && body !== null
    ? (body as Record<string, unknown>).orderId
    : undefined;
  if (typeof orderId !== "string" || !UUID.test(orderId)) {
    return json(400, { ok: false, reason: "invalid_request" });
  }

  const outcome = await deps.sender.sendConfirmation(orderId, userId);
  switch (outcome) {
    case "sent":
    case "already_sent":
      return json(200, { ok: true, outcome });
    case "not_confirmed":
      return json(200, { ok: false, reason: "order_not_found" });
    case "failed":
      return json(200, { ok: false, reason: "email_failed" });
  }
}
