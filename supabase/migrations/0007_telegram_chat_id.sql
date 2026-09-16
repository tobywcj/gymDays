-- ============================================================================
-- Telegram linking. A client links by opening the bot deep link
-- (t.me/<bot>?start=<client_id>); the bridge saves their numeric chat id here.
-- Outbound Telegram messages are addressed to this chat id.
-- ============================================================================

alter table clients add column if not exists telegram_chat_id text;
create index if not exists idx_clients_telegram_chat on clients(telegram_chat_id);
