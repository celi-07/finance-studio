begin;

-- Public portfolio demo: counters only, never financial records or conversation content.
create table public.ledger_ai_demo_usage (
  usage_date date not null,
  visitor_hash text not null,
  requests integer not null default 0,
  last_request_at timestamptz not null default now(),
  primary key (usage_date, visitor_hash)
);
alter table public.ledger_ai_demo_usage enable row level security;
revoke all on public.ledger_ai_demo_usage from public, anon, authenticated;

create function public.ledger_ai_demo_reserve(p_visitor_hash text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare day_key date := (now() at time zone 'UTC')::date;
  global_used integer;
  visitor_used integer;
  previous_request timestamptz;
begin
  if p_visitor_hash !~ '^[a-f0-9]{64}$' or p_visitor_hash is null then return false; end if;
  perform pg_catalog.pg_advisory_xact_lock(914772018);
  select requests into global_used from public.ledger_ai_demo_usage
    where usage_date = day_key and ledger_ai_demo_usage.visitor_hash = 'global';
  select requests, last_request_at into visitor_used, previous_request from public.ledger_ai_demo_usage
    where usage_date = day_key and ledger_ai_demo_usage.visitor_hash = p_visitor_hash;
  if coalesce(global_used, 0) >= 100 or coalesce(visitor_used, 0) >= 20
    or previous_request > now() - interval '5 seconds' then return false; end if;
  insert into public.ledger_ai_demo_usage(usage_date, visitor_hash, requests, last_request_at)
    values (day_key, 'global', 1, now()), (day_key, p_visitor_hash, 1, now())
    on conflict (usage_date, visitor_hash) do update
      set requests = ledger_ai_demo_usage.requests + 1, last_request_at = now();
  delete from public.ledger_ai_demo_usage where usage_date < day_key - 7;
  return true;
end;
$$;
revoke all on function public.ledger_ai_demo_reserve(text) from public;
grant execute on function public.ledger_ai_demo_reserve(text) to anon, authenticated;
commit;
