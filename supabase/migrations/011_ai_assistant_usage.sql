begin;

-- Persist usage limits across Vercel instances. No financial data or chat content is stored here.
create table public.ledger_ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null,
  requests integer not null default 0,
  last_request_at timestamptz not null default now(),
  primary key (user_id, usage_date)
);
alter table public.ledger_ai_usage enable row level security;
revoke all on public.ledger_ai_usage from public, anon, authenticated;

create function public.ledger_ai_reserve() returns boolean
language plpgsql security definer set search_path = '' as $$
declare owner_id uuid := auth.uid();
  used integer;
  last_request timestamptz;
begin
  if owner_id is null or not public.ledger_email_verified() then
    raise exception 'Verify your email before using the assistant.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text, 117));
  select requests, last_request_at into used, last_request from public.ledger_ai_usage
    where user_id = owner_id and usage_date = (now() at time zone 'UTC')::date for update;
  if coalesce(used, 0) >= 100 or last_request > now() - interval '5 seconds' then return false; end if;
  insert into public.ledger_ai_usage(user_id, usage_date, requests, last_request_at)
    values (owner_id, (now() at time zone 'UTC')::date, 1, now())
    on conflict (user_id, usage_date) do update set requests = ledger_ai_usage.requests + 1, last_request_at = now();
  -- Retain only a rolling usage window, independent of the financial ledger.
  delete from public.ledger_ai_usage where user_id = owner_id and usage_date < current_date - 7;
  return true;
end;
$$;
revoke all on function public.ledger_ai_reserve() from public, anon;
grant execute on function public.ledger_ai_reserve() to authenticated;
commit;
