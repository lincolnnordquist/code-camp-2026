import { EmailError, type EmailMessage, sendEmail } from "./email/resend.ts";

export type ConfirmationOutcome = "sent" | "already_sent" | "not_confirmed" | "failed";

export interface OrderEmailSender {
  // userId is the attendee's id when the caller is their session, and null for the webhook.
  // Never throws for a refused or failed send; it returns "failed" after clearing the claim.
  // "already_sent" means another call holds the claim; that call's send can still fail, so
  // it is not proof of delivery. An order that is not userId's returns "not_confirmed".
  sendConfirmation(orderId: string, userId: string | null): Promise<ConfirmationOutcome>;
}

// Events store no time zone, so the email shows every hold end in this one
// (ARCHITECTURE.md, "Intentional simplifications").
export const EVENT_TIME_ZONE = "America/Denver";

export type ClaimedOrder = {
  ok: true;
  outcome: "first_time";
  orderId: string;
  boothCode: string;
  boothName: string;
  type: "reservation" | "prepaid";
  pickupCode: string;
  holdEndsAt: string | null;
  totalCents: number;
  currency: string;
  buyerEmail: string;
  privateToken: string;
  items: { name: string; quantity: number; unitPriceCents: number }[];
};

type ClaimReply =
  | ClaimedOrder
  | { ok: true; outcome: "repeat" }
  | { ok: false; reason: string };

export type OrderEmailContent = { subject: string; html: string; text: string };

export type OrderEmailDeps = {
  rpc(name: string, args: Record<string, unknown>): Promise<unknown>;
  send(message: EmailMessage): Promise<string>;
  from: string;
  appUrl: string;
};

export function privateOrderUrl(appUrl: string, privateToken: string): string {
  return `${appUrl.replace(/\/+$/, "")}/orders/link/${privateToken}`;
}

function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

function formatHoldEnd(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: EVENT_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(iso));
}

// The same words orderLabels() in src/shared/ui/labels.ts gives a confirmed order. Edge
// Functions do not import src/, so tests/payments/order-email.test.ts compares the two.
export function confirmedWording(
  type: ClaimedOrder["type"],
  totalCents: number,
  currency: string,
): { headline: string; payment: string } {
  const amount = formatMoney(totalCents, currency);
  return type === "reservation"
    ? { headline: "Reservation confirmed", payment: `Pay ${amount} at the booth` }
    : { headline: "Order confirmed", payment: `Paid ${amount} with Square` };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Always the confirmed wording, also for an order that is ready or collected at send time.
export function orderEmailContent(order: ClaimedOrder, appUrl: string): OrderEmailContent {
  const { headline, payment } = confirmedWording(order.type, order.totalCents, order.currency);
  const booth = `${order.boothName}, booth ${order.boothCode}`;
  const link = privateOrderUrl(appUrl, order.privateToken);
  const heldUntil = order.type === "reservation" && order.holdEndsAt
    ? `Held until ${formatHoldEnd(order.holdEndsAt)}`
    : null;
  const lines = order.items.map((item) => ({
    label: `${item.quantity} × ${item.name}`,
    price: formatMoney(item.quantity * item.unitPriceCents, order.currency),
  }));
  const total = formatMoney(order.totalCents, order.currency);

  const text = [
    headline,
    booth,
    "",
    ...lines.map((line) => `${line.label}  ${line.price}`),
    `Total  ${total}`,
    payment,
    "",
    `Pickup code: ${order.pickupCode}`,
    ...(heldUntil ? [heldUntil] : []),
    "",
    "Open this order on any device:",
    link,
  ].join("\n");

  const cell = "padding:6px 0;border-bottom:1px solid #dbd9e2;";
  const html = `<!doctype html>
<html><body style="margin:0;padding:24px 16px;background:#f7f5ff;font-family:Arial,Helvetica,sans-serif;color:#312f36;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px;">
<tr><td>
<h1 style="margin:0 0 4px;font-size:22px;">${escapeHtml(headline)}</h1>
<p style="margin:0 0 20px;color:#737279;">${escapeHtml(booth)}</p>
<p style="margin:0;color:#737279;font-size:14px;">Pickup code</p>
<p style="margin:0 0 4px;font-size:40px;font-weight:bold;letter-spacing:6px;color:#6f00d6;">${escapeHtml(order.pickupCode)}</p>
${heldUntil ? `<p style="margin:0 0 20px;">${escapeHtml(heldUntil)}</p>` : `<div style="height:16px;"></div>`}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${lines.map((line) => `<tr><td style="${cell}">${escapeHtml(line.label)}</td><td align="right" style="${cell}">${escapeHtml(line.price)}</td></tr>`).join("\n")}
<tr><td style="padding:8px 0;font-weight:bold;">Total</td><td align="right" style="padding:8px 0;font-weight:bold;">${escapeHtml(total)}</td></tr>
</table>
<p style="margin:8px 0 24px;">${escapeHtml(payment)}</p>
<p style="margin:0 0 8px;"><a href="${escapeHtml(link)}" style="display:inline-block;background:#6f00d6;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:24px;">Open your order</a></p>
<p style="margin:0;color:#737279;font-size:14px;">This link opens this order on any device.</p>
</td></tr>
</table>
</body></html>`;

  return {
    subject: `Your pickup code for ${order.boothName}: ${order.pickupCode}`,
    html,
    text,
  };
}

function log(event: string, fields: Record<string, unknown>): void {
  console.error(JSON.stringify({ event, ...fields }));
}

export function createOrderEmailSender(deps: OrderEmailDeps): OrderEmailSender {
  async function clearClaim(orderId: string, userId: string | null): Promise<void> {
    try {
      const reply = await deps.rpc("svc_clear_email_sent", {
        p_order_id: orderId,
        p_user_id: userId,
      }) as { ok: boolean; reason?: string };
      if (!reply.ok) log("order_email_claim_not_cleared", { orderId, reason: reply.reason });
    } catch (error) {
      log("order_email_claim_not_cleared", { orderId, message: String(error) });
    }
  }

  return {
    async sendConfirmation(orderId, userId) {
      let claim: ClaimReply;
      try {
        claim = await deps.rpc("svc_mark_email_sent", {
          p_order_id: orderId,
          p_user_id: userId,
        }) as ClaimReply;
      } catch (error) {
        log("order_email_claim_failed", { orderId, message: String(error) });
        return "failed";
      }
      if (!claim.ok) return "not_confirmed";
      if (claim.outcome === "repeat") return "already_sent";

      try {
        await deps.send({
          from: deps.from,
          to: claim.buyerEmail,
          ...orderEmailContent(claim, deps.appUrl),
        });
        return "sent";
      } catch (error) {
        log("order_email_send_failed", {
          orderId,
          httpStatus: error instanceof EmailError ? error.httpStatus : null,
          resendName: error instanceof EmailError ? error.resendName : null,
          message: String(error),
        });
        await clearClaim(orderId, userId);
        return "failed";
      }
    },
  };
}

// Missing settings do not throw, so a function that builds this at start-up keeps working
// before email is set up; each call then makes no claim and returns "failed".
export function orderEmailFromEnvironment(
  readEnv: (name: string) => string | undefined,
  rpc: (name: string, args: Record<string, unknown>) => Promise<unknown>,
): OrderEmailSender {
  const apiKey = readEnv("RESEND_API_KEY");
  const from = readEnv("EMAIL_FROM");
  const appUrl = readEnv("APP_URL");
  if (!apiKey || !from || !appUrl) {
    const missing = [
      ["RESEND_API_KEY", apiKey],
      ["EMAIL_FROM", from],
      ["APP_URL", appUrl],
    ].filter(([, value]) => !value).map(([name]) => name);
    return {
      sendConfirmation(orderId) {
        log("order_email_not_configured", { orderId, missing });
        return Promise.resolve("failed");
      },
    };
  }
  return createOrderEmailSender({
    rpc,
    send: (message) => sendEmail(apiKey, message),
    from,
    appUrl,
  });
}
