// ─────────────────────────────────────────────────────────────────────────────
// Gym Days — Telegram bridge. Free + official Telegram Bot API, no public URL.
//
// Long-polls getUpdates and:
//   • `/start <client_id>`  → links the chat to a client (POST /messaging/telegram/link)
//   • any other text        → POST /messaging/inbound/telegram → reply with the result
//
// Outbound agent-initiated messages go directly via the Python telegram provider
// (api.telegram.org) — this bridge only handles inbound + linking.
//
// Env:
//   TELEGRAM_BOT_TOKEN   (required)
//   AI_SERVICE_URL       default http://localhost:8001
// ─────────────────────────────────────────────────────────────────────────────
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const AI = process.env.AI_SERVICE_URL || "http://localhost:8001";

if (!TOKEN) {
  console.error("TELEGRAM_BOT_TOKEN not set — get one from @BotFather and export it.");
  process.exit(1);
}

const API = (method) => `https://api.telegram.org/bot${TOKEN}/${method}`;

async function tg(method, payload) {
  const r = await fetch(API(method), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return r.json();
}

async function send(chatId, text) {
  await tg("sendMessage", { chat_id: chatId, text });
}

async function handle(msg) {
  const chatId = msg.chat?.id;
  const text = (msg.text || "").trim();
  const username = msg.from?.username || null;
  if (!chatId || !text) return;

  // Linking: /start <client_id>
  if (text.startsWith("/start")) {
    const code = text.split(/\s+/)[1];
    if (!code) {
      await send(chatId, "Welcome! Open the link your trainer sent you to connect your plan.");
      return;
    }
    try {
      const r = await fetch(`${AI}/messaging/telegram/link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, chat_id: String(chatId), username }),
      });
      const d = await r.json();
      if (d.ok) {
        await send(chatId, `✅ Linked, ${d.client_name || "athlete"}! Ask me anything about your training.`);
      } else {
        await send(chatId, "That link didn't work — ask your trainer for a fresh one.");
      }
    } catch (e) {
      await send(chatId, "Couldn't link right now — try again shortly.");
    }
    return;
  }

  // Normal message → concierge agent.
  try {
    const r = await fetch(`${AI}/messaging/inbound/telegram`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: String(chatId), body: text, username }),
    });
    const d = await r.json();
    if (d.reply) await send(chatId, d.reply);
  } catch (e) {
    await send(chatId, "Sorry — my assistant is offline right now. Try again shortly.");
  }
}

async function main() {
  const me = await tg("getMe", {});
  if (!me.ok) {
    console.error("getMe failed — check TELEGRAM_BOT_TOKEN:", me);
    process.exit(1);
  }
  console.log(`Telegram bridge live as @${me.result.username} (AI=${AI}). Long-polling…`);

  let offset = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const r = await fetch(API("getUpdates") + `?timeout=30&offset=${offset}`);
      const d = await r.json();
      if (d.ok) {
        for (const u of d.result) {
          offset = u.update_id + 1;
          if (u.message) await handle(u.message);
        }
      }
    } catch (e) {
      console.error("poll error:", String(e));
      await new Promise((res) => setTimeout(res, 2000));
    }
  }
}

main();
