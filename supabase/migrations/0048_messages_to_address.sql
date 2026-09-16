-- Persist the actual recipient address per message so the email history shows
-- where each message was really sent — not the client's current default email
-- (which is wrong when the trainer edited the recipient before sending).

alter table messages add column if not exists to_address text;

-- Backfill existing rows from their thread's recipient handle (the address used
-- when the thread was created). Best-effort: only fills email rows that have one.
update messages m
set    to_address = t.external_handle
from   messaging_threads t
where  m.thread_id = t.id
  and  m.to_address is null
  and  t.external_handle is not null;

comment on column messages.to_address is
  'Actual recipient address this message was delivered to (email address / chat id). Null for legacy rows without a thread handle.';
