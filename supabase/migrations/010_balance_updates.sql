begin;

create table public.balance_updates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  account_id uuid not null,
  recorded_on date not null,
  frequency text not null check (frequency in ('weekly', 'monthly')),
  balance_minor bigint not null check (balance_minor between -9007199254740991 and 9007199254740991),
  unique (user_id, account_id, recorded_on),
  foreign key (user_id, account_id) references public.accounts (user_id, id) on delete cascade
);

alter table public.balance_updates enable row level security;
revoke all on public.balance_updates from public, anon, authenticated;
grant select, insert, update, delete on public.balance_updates to authenticated;
create policy balance_updates_owner on public.balance_updates for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy email_verified_session on public.balance_updates as restrictive for all to authenticated
  using ((select public.ledger_email_verified())) with check ((select public.ledger_email_verified()));

create function public.ledger_check_balance_update() returns trigger
language plpgsql set search_path = '' as $$
declare account public.accounts%rowtype;
begin
  if tg_op = 'UPDATE' and (new.account_id is distinct from old.account_id or new.recorded_on is distinct from old.recorded_on) then
    raise exception 'Keep the balance update on its original account and date.';
  end if;
  select * into account from public.accounts where user_id = new.user_id and id = new.account_id for share;
  if not found or account.archived then
    raise exception 'Choose an active account.';
  end if;
  if new.recorded_on < account.opening_date or new.recorded_on > (now() at time zone 'Asia/Jakarta')::date then
    raise exception 'Choose a date from the account opening through today.';
  end if;
  if account.kind = 'investment' and new.balance_minor < 0 then
    raise exception 'Enter an investment value of zero or more.';
  end if;
  return new;
end;
$$;
create trigger balance_update_before_write before insert or update on public.balance_updates
  for each row execute function public.ledger_check_balance_update();
revoke execute on function public.ledger_check_balance_update() from public, anon, authenticated;

create or replace function public.ledger_check_account_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.kind <> old.kind then raise exception 'An existing account cannot change type.'; end if;
  if new.opening_date > old.opening_date and (
    exists (select 1 from public.reimbursement_receipts r where r.user_id = new.user_id and r.account_id = new.id and r.received_on < new.opening_date)
    or exists (select 1 from public.investment_valuations v where v.user_id = new.user_id and v.investment_account_id = new.id and v.valued_on < new.opening_date)
    or exists (select 1 from public.balance_updates b where b.user_id = new.user_id and b.account_id = new.id and b.recorded_on < new.opening_date)
  ) then raise exception 'Opening date must be on or before the earliest linked entry.'; end if;
  return new;
end;
$$;

commit;
