-- Enable Supabase Realtime for the messages table so the messaging portal
-- receives instant updates when the Telegram bridge or AI agents insert rows.
alter publication supabase_realtime add table messages;
