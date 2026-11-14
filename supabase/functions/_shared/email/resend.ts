export type EmailMessage = {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
};

export class EmailError extends Error {
  readonly httpStatus: number | null;
  readonly resendName: string;

  constructor(httpStatus: number | null, resendName: string, message: string) {
    super(message);
    this.name = "EmailError";
    this.httpStatus = httpStatus;
    this.resendName = resendName;
  }
}

const SEND_URL = "https://api.resend.com/emails";
const TIMEOUT_MS = 10_000;

type ResendReply = { id?: unknown; name?: unknown; message?: unknown };

export async function sendEmail(
  apiKey: string,
  message: EmailMessage,
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  let response: Response;
  try {
    response = await fetchFn(SEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        // Resend answers 403 to a direct API call without a User-Agent.
        "User-Agent": "order-email/1.0",
      },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (cause) {
    throw new EmailError(
      null,
      "network_error",
      `Resend request did not complete: ${String(cause)}`,
    );
  }

  let reply: ResendReply | null;
  try {
    reply = JSON.parse(await response.text()) as ResendReply;
  } catch {
    reply = null;
  }

  if (!response.ok) {
    throw new EmailError(
      response.status,
      typeof reply?.name === "string" ? reply.name : `http_${response.status}`,
      typeof reply?.message === "string"
        ? reply.message
        : `Resend answered HTTP ${response.status}`,
    );
  }
  if (typeof reply?.id !== "string") {
    throw new EmailError(response.status, "unexpected_reply", "Resend reply has no id");
  }
  return reply.id;
}
