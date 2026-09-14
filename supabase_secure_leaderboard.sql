-- Apply after the leaderboard table exists, before releasing the secure client.
-- Keeps all existing rows and public reads; only the server secret can insert.
begin;

alter table public.leaderboard enable row level security;
revoke insert on table public.leaderboard from anon, authenticated;
drop policy if exists "Public can submit leaderboard scores" on public.leaderboard;
grant select on table public.leaderboard to anon, authenticated;

commit;

-- Read-only verification: both insert columns must be false, select true.
select role_name,
  has_table_privilege(role_name, 'public.leaderboard', 'SELECT') as can_read,
  has_table_privilege(role_name, 'public.leaderboard', 'INSERT') as can_insert
from (values ('anon'), ('authenticated')) as roles(role_name);
