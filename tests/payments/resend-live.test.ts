import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "vitest";
import { sendEmail } from "../../supabase/functions/_shared/email/resend";
import { orderEmailContent } from "../../supabase/functions/_shared/order-email";

const ENV_FILE = new URL("../../supabase/functions/.env", import.meta.url);
const NAMES = ["RESEND_API_KEY", "EMAIL_FROM", "RESEND_TEST_TO"] as const;

async function readSettings(): Promise<Record<(typeof NAMES)[number], string> | undefined> {
  let text: string;
  try {
    text = await readFile(ENV_FILE, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const values: Partial<Record<(typeof NAMES)[number], string>> = {};
  for (const name of NAMES) {
    const line = text.split("\n").find((entry) => entry.startsWith(`${name}=`));
    const value = line?.slice(name.length + 1).trim().replace(/^["']|["']$/g, "");
    if (!value) return undefined;
    values[name] = value;
  }
  return values as Record<(typeof NAMES)[number], string>;
}

const settings = await readSettings();
if (!settings) {
  console.log(
    `Skipping the live Resend test: ${NAMES.join(", ")} are not all set in supabase/functions/.env`,
  );
}

test.skipIf(!settings)("live: Resend accepts a reservation confirmation", { timeout: 30_000 }, async () => {
  const content = orderEmailContent({
    ok: true,
    outcome: "first_time",
    orderId: "0a000000-0000-4000-8000-000000000001",
    boothCode: "B4",
    boothName: "Moon Ceramics",
    type: "reservation",
    pickupCode: "4821",
    holdEndsAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    totalCents: 3600,
    currency: "USD",
    buyerEmail: settings!.RESEND_TEST_TO,
    privateToken: "7b000000-0000-4000-8000-000000000007",
    items: [{ name: "Mug", quantity: 2, unitPriceCents: 1800 }],
  }, "http://localhost:5173");

  const id = await sendEmail(settings!.RESEND_API_KEY, {
    from: settings!.EMAIL_FROM,
    to: settings!.RESEND_TEST_TO,
    ...content,
  });

  assert.ok(id.length > 0);
});
