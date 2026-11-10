begin;

alter table public.categories drop constraint categories_color_check,
  add constraint categories_color_check check (color in
    ('green', 'blue', 'amber', 'violet', 'rose', 'teal', 'cyan', 'indigo', 'plum', 'peach', 'lime', 'slate', 'gold'));

create table public.savings_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  ledger_id uuid,
  name text not null check (length(btrim(name)) between 1 and 70),
  currency text not null check (currency in ('IDR', 'USD', 'SGD', 'EUR', 'GBP', 'AUD', 'CAD', 'CNY', 'HKD', 'INR',
    'JPY', 'KRW', 'MYR', 'NZD', 'PHP', 'THB', 'VND', 'AED', 'CHF', 'KWD')),
  target_minor bigint not null check (target_minor between 1 and 9007199254740991),
  reserved_minor bigint not null default 0 check (reserved_minor between 0 and 9007199254740991),
  target_on date,
  foreign key (user_id, ledger_id) references public.finance_books(user_id, id) deferrable initially deferred
);
create index savings_goals_owner_sheet on public.savings_goals (user_id, ledger_id);
alter table public.savings_goals enable row level security;
revoke all on public.savings_goals from public, anon, authenticated;
grant select, insert, update, delete on public.savings_goals to authenticated;
create policy savings_goals_owner on public.savings_goals for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create trigger goal_sheet_before_update before update on public.savings_goals
  for each row execute function public.ledger_keep_record_sheet();

-- Older entries still appear in reports. Opening balances supply the starting point for tracked balances.

create or replace function public.ledger_check_account_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.kind <> old.kind then raise exception 'An existing account cannot change type.'; end if;
  if new.opening_date > old.opening_date and (
    exists (select 1 from public.reimbursement_receipts r where r.user_id = new.user_id and r.account_id = new.id and r.received_on < new.opening_date)
    or exists (select 1 from public.investment_valuations v where v.user_id = new.user_id and v.investment_account_id = new.id and v.valued_on < new.opening_date)
  ) then raise exception 'Opening date must be on or before the earliest linked entry.'; end if;
  return new;
end;
$$;

create or replace function public.ledger_check_transaction() returns trigger
language plpgsql set search_path = '' as $$
declare
  source public.accounts%rowtype;
  destination public.accounts%rowtype;
  received numeric;
  first_payment date;
  prior_source uuid;
  prior_destination uuid;
  prior_category uuid;
  chosen_category public.categories%rowtype;
begin
  if tg_op = 'UPDATE' then
    prior_source := old.account_id;
    prior_destination := old.destination_account_id;
    prior_category := old.category_id;
  else
    -- An upsert visits the insert trigger before it can update an existing row.
    select account_id, destination_account_id, category_id into prior_source, prior_destination, prior_category
    from public.transactions where user_id = new.user_id and id = new.id;
  end if;
  select * into source from public.accounts where user_id = new.user_id and id = new.account_id for share;
  if not found or (source.archived and source.id is distinct from prior_source)
    or (source.kind = 'investment') <> (new.kind = 'investment_withdrawal') then
    raise exception 'Choose a source account that matches the entry type.';
  end if;
  if new.destination_account_id is not null then
    select * into destination from public.accounts where user_id = new.user_id and id = new.destination_account_id for share;
    if not found or (destination.archived and destination.id is distinct from prior_destination)
      or (destination.kind = 'investment') <> (new.kind = 'investment_contribution') then
      raise exception 'Choose a destination account that matches the entry type.';
    end if;
  end if;
  if new.category_id is not null then
    select * into chosen_category from public.categories where user_id = new.user_id and id = new.category_id for share;
    if not found or chosen_category.applicable_kind <> new.kind
      or (chosen_category.archived and chosen_category.id is distinct from prior_category) then
      raise exception 'Choose a category that matches the entry type.';
    end if;
  end if;
  if tg_op = 'UPDATE' then
    select coalesce(sum(amount_minor), 0), min(received_on) into received, first_payment
    from public.reimbursement_receipts where user_id = new.user_id and expense_id = new.id;
    if received > new.reimbursable_minor or (first_payment is not null and first_payment < new.occurred_on) then
      raise exception 'The expense must preserve its linked reimbursement payments.';
    end if;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

commit;
