import "server-only";

// Each channel is plain fetch. Base URLs are overridable so tests can point at a local stub.
// A channel without credentials runs in "demo mode": alerts are stored as 'logged', not sent.

export type Channel = "email" | "telegram" | "whatsapp";
export const CHANNELS: Channel[] = ["email", "telegram", "whatsapp"];

export const CHANNEL_LABEL: Record<Channel, string> = {
  email: "Email",
  telegram: "Telegram",
  whatsapp: "WhatsApp",
};

const env = (k: string) => process.env[k]?.trim() || undefined;

export function isLive(ch: Channel): boolean {
  switch (ch) {
    case "email": return !!(env("RESEND_API_KEY") && env("ALERT_EMAIL_FROM"));
    case "telegram": return !!env("TELEGRAM_BOT_TOKEN");
    case "whatsapp": return !!(env("WHATSAPP_TOKEN") && env("WHATSAPP_PHONE_ID") && env("WHATSAPP_TEMPLATE"));
  }
}

export function validAddress(ch: Channel, address: string): boolean {
  switch (ch) {
    case "email": return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address);
    case "telegram": return /^-?\d{5,20}$/.test(address);
    case "whatsapp": return /^\+\d{8,15}$/.test(address);
  }
}

export type Message = { subject: string; text: string; link: string };

async function post(url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  try { return JSON.parse(text); } catch { return text; }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export async function send(ch: Channel, address: string, m: Message): Promise<void> {
  switch (ch) {
    case "email": {
      const base = env("RESEND_API_BASE") ?? "https://api.resend.com";
      await post(`${base}/emails`, { authorization: `Bearer ${env("RESEND_API_KEY")}` }, {
        from: env("ALERT_EMAIL_FROM"),
        to: [address],
        subject: m.subject,
        text: m.text,
        html: `<p style="font:15px/1.5 sans-serif">${esc(m.text.replace(m.link, "").trim())}</p>` +
              `<p><a href="${esc(m.link)}" style="font:600 15px sans-serif">Open dTBM</a></p>`,
      });
      return;
    }
    case "telegram": {
      const base = env("TELEGRAM_API_BASE") ?? "https://api.telegram.org";
      await post(`${base}/bot${env("TELEGRAM_BOT_TOKEN")}/sendMessage`, {}, {
        chat_id: address,
        text: m.text,
        disable_web_page_preview: true,
      });
      return;
    }
    case "whatsapp": {
      // Business-initiated WhatsApp messages must use a Meta-approved template.
      // Expected template body: "dTBM alert: {{1}}" (one text parameter).
      const base = env("WHATSAPP_API_BASE") ?? "https://graph.facebook.com";
      await post(`${base}/v21.0/${env("WHATSAPP_PHONE_ID")}/messages`,
        { authorization: `Bearer ${env("WHATSAPP_TOKEN")}` }, {
          messaging_product: "whatsapp",
          to: address.replace(/^\+/, ""),
          type: "template",
          template: {
            name: env("WHATSAPP_TEMPLATE"),
            language: { code: env("WHATSAPP_TEMPLATE_LANG") ?? "en" },
            components: [{ type: "body", parameters: [{ type: "text", text: m.text.replace(/\s+/g, " ") }] }],
          },
        });
      return;
    }
  }
}

/** Telegram linking without a webhook: find "/start <code>" in the bot's recent updates. */
export async function findTelegramChat(code: string): Promise<string | null> {
  const token = env("TELEGRAM_BOT_TOKEN");
  if (!token) return null;
  const base = env("TELEGRAM_API_BASE") ?? "https://api.telegram.org";
  const res = await fetch(`${base}/bot${token}/getUpdates?allowed_updates=["message"]`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Telegram getUpdates HTTP ${res.status}`);
  const data = (await res.json()) as { result?: { message?: { text?: string; chat?: { id: number } } }[] };
  for (const u of (data.result ?? []).reverse()) {
    if (u.message?.text?.trim() === `/start ${code}` && u.message.chat) return String(u.message.chat.id);
  }
  return null;
}

export function telegramBotUsername(): string | undefined {
  return env("TELEGRAM_BOT_USERNAME")?.replace(/^@/, "");
}
