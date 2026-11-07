begin;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  locale text not null default 'id-ID' check (locale = 'id-ID'),
  currency text not null default 'IDR' check (currency = 'IDR'),
  time_zone text not null default 'Asia/Jakarta' check (time_zone = 'Asia/Jakarta')
);

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null check (length(btrim(name)) between 1 and 70),
  kind text not null check (kind in ('bank', 'wallet', 'cash', 'investment')),
  opening_minor bigint not null check (opening_minor between 0 and 9007199254740991),
  opening_date date not null,
  archived boolean not null default false,
  unique (user_id, id)
);
create unique index accounts_owner_name on public.accounts (user_id, lower(name));

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null check (length(btrim(name)) between 1 and 70),
  applicable_kind text not null check (applicable_kind in ('income', 'expense')),
  color text not null default 'green' check (color in ('green', 'blue', 'amber', 'violet', 'rose')),
  archived boolean not null default false,
  unique (user_id, id)
);
create unique index categories_owner_kind_name on public.categories (user_id, applicable_kind, lower(name));

create table public.field_definitions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  label text not null check (length(btrim(label)) between 1 and 70),
  field_type text not null check (field_type in ('text', 'number', 'date', 'select', 'checkbox')),
  options jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  required boolean not null default false,
  position integer not null default 0 check (position >= 0),
  archived boolean not null default false,
  unique (user_id, id)
);
create unique index fields_owner_label on public.field_definitions (user_id, lower(label));

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  occurred_on date not null,
  kind text not null check (kind in ('expense', 'income', 'transfer', 'investment_contribution', 'investment_withdrawal')),
  description text not null check (length(btrim(description)) between 1 and 160),
  amount_minor bigint not null check (amount_minor between 1 and 9007199254740991),
  account_id uuid not null,
  destination_account_id uuid,
  category_id uuid,
  notes text not null default '',
  custom_values jsonb not null default '{}'::jsonb check (jsonb_typeof(custom_values) = 'object'),
  reimbursable_minor bigint not null default 0 check (reimbursable_minor between 0 and amount_minor),
  counterparty text not null default '',
  due_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id),
  foreign key (user_id, account_id) references public.accounts(user_id, id) deferrable initially deferred,
  foreign key (user_id, destination_account_id) references public.accounts(user_id, id) deferrable initially deferred,
  foreign key (user_id, category_id) references public.categories(user_id, id) deferrable initially deferred,
  check ((kind in ('transfer', 'investment_contribution', 'investment_withdrawal')) = (destination_account_id is not null)),
  check (account_id is distinct from destination_account_id),
  check (category_id is null or kind in ('income', 'expense')),
  check ((reimbursable_minor = 0 and counterparty = '' and due_on is null)
      or (kind = 'expense' and reimbursable_minor > 0 and length(btrim(counterparty)) > 0)),
  check (due_on is null or due_on >= occurred_on)
);
create index transactions_owner_date on public.transactions (user_id, occurred_on);
create index transactions_owner_account on public.transactions (user_id, account_id);
create index transactions_owner_destination on public.transactions (user_id, destination_account_id);
create index transactions_owner_category on public.transactions (user_id, category_id);

create table public.reimbursement_receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  expense_id uuid not null,
  account_id uuid not null,
  received_on date not null,
  amount_minor bigint not null check (amount_minor between 1 and 9007199254740991),
  notes text not null default '',
  unique (user_id, id),
  foreign key (user_id, expense_id) references public.transactions(user_id, id) deferrable initially deferred,
  foreign key (user_id, account_id) references public.accounts(user_id, id) deferrable initially deferred
);
create index receipts_owner_expense on public.reimbursement_receipts (user_id, expense_id);
create index receipts_owner_account on public.reimbursement_receipts (user_id, account_id);
create index receipts_owner_date on public.reimbursement_receipts (user_id, received_on);

create table public.investment_valuations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  investment_account_id uuid not null,
  valued_on date not null,
  value_minor bigint not null check (value_minor between 0 and 9007199254740991),
  created_at timestamptz not null default now(),
  unique (user_id, id),
  unique (user_id, investment_account_id, valued_on),
  foreign key (user_id, investment_account_id) references public.accounts(user_id, id) deferrable initially deferred
);

create function public.ledger_check_account_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.kind <> old.kind then raise exception 'An existing account cannot change type.'; end if;
  if new.opening_date > old.opening_date and (
    exists (select 1 from public.transactions t where t.user_id = new.user_id
      and (t.account_id = new.id or t.destination_account_id = new.id) and t.occurred_on < new.opening_date)
    or exists (select 1 from public.reimbursement_receipts r where r.user_id = new.user_id and r.account_id = new.id and r.received_on < new.opening_date)
    or exists (select 1 from public.investment_valuations v where v.user_id = new.user_id and v.investment_account_id = new.id and v.valued_on < new.opening_date)
  ) then raise exception 'Opening date must be on or before the earliest linked entry.'; end if;
  return new;
end;
$$;

create function public.ledger_check_transaction() returns trigger
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
  if not found or source.opening_date > new.occurred_on or (source.archived and source.id is distinct from prior_source)
    or (source.kind = 'investment') <> (new.kind = 'investment_withdrawal') then
    raise exception 'Choose a source account that was open on the transaction date and matches the entry type.';
  end if;
  if new.destination_account_id is not null then
    select * into destination from public.accounts where user_id = new.user_id and id = new.destination_account_id for share;
    if not found or destination.opening_date > new.occurred_on or (destination.archived and destination.id is distinct from prior_destination)
      or (destination.kind = 'investment') <> (new.kind = 'investment_contribution') then
      raise exception 'Choose a destination account that was open on the transaction date and matches the entry type.';
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

create function public.ledger_check_receipt() returns trigger
language plpgsql set search_path = '' as $$
declare
  expense public.transactions%rowtype;
  account public.accounts%rowtype;
  prior public.reimbursement_receipts%rowtype;
  received numeric;
begin
  -- Lock the expense so concurrent receipts and expense edits serialize.
  select * into expense from public.transactions where user_id = new.user_id and id = new.expense_id for no key update;
  if not found or expense.kind <> 'expense' or expense.reimbursable_minor <= 0 or new.received_on < expense.occurred_on
    or new.received_on > (now() at time zone 'Asia/Jakarta')::date then
    raise exception 'Choose a reimbursable expense and a payment date on or after the expense.';
  end if;
  select * into prior from public.reimbursement_receipts where user_id = new.user_id and id = new.id;
  if found then
    if row(prior.expense_id, prior.account_id, prior.received_on, prior.amount_minor, prior.notes)
       is distinct from row(new.expense_id, new.account_id, new.received_on, new.amount_minor, new.notes) then
      raise exception 'This payment was already recorded with different details. Refresh the workspace before making further changes.';
    end if;
    return new;
  end if;
  select * into account from public.accounts where user_id = new.user_id and id = new.account_id for share;
  if not found or account.kind = 'investment' or account.archived or account.opening_date > new.received_on then
    raise exception 'Choose a cash account that was open on the payment date.';
  end if;
  select coalesce(sum(amount_minor), 0) into received from public.reimbursement_receipts
  where user_id = new.user_id and expense_id = new.expense_id;
  if new.amount_minor + received > expense.reimbursable_minor then raise exception 'The payment exceeds the outstanding amount.'; end if;
  return new;
end;
$$;

create function public.ledger_check_valuation() returns trigger
language plpgsql set search_path = '' as $$
declare account public.accounts%rowtype;
begin
  select * into account from public.accounts where user_id = new.user_id and id = new.investment_account_id for share;
  if not found or account.kind <> 'investment' or account.archived or account.opening_date > new.valued_on
    or new.valued_on > (now() at time zone 'Asia/Jakarta')::date then
    raise exception 'Choose an investment account open on the valuation date.';
  end if;
  return new;
end;
$$;

create function public.ledger_keep_definition_type() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_table_name = 'categories' then
    if new.applicable_kind <> old.applicable_kind then raise exception 'An existing category cannot change type.'; end if;
  else
    if new.field_type <> old.field_type then raise exception 'An existing custom field cannot change type.'; end if;
  end if;
  return new;
end;
$$;

create trigger account_before_update before update on public.accounts for each row execute function public.ledger_check_account_update();
create trigger category_before_update before update on public.categories for each row execute function public.ledger_keep_definition_type();
create trigger field_before_update before update on public.field_definitions for each row execute function public.ledger_keep_definition_type();
create trigger transaction_before_write before insert or update on public.transactions for each row execute function public.ledger_check_transaction();
create trigger receipt_before_insert before insert on public.reimbursement_receipts for each row execute function public.ledger_check_receipt();
create trigger valuation_before_write before insert or update on public.investment_valuations for each row execute function public.ledger_check_valuation();

alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select, insert, update on public.profiles to authenticated;
create policy profile_owner on public.profiles for all to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

do $$
declare table_name text;
begin
  foreach table_name in array array['accounts','categories','field_definitions','transactions','reimbursement_receipts','investment_valuations'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from anon, authenticated', table_name);
    execute format('grant select, insert on public.%I to authenticated', table_name);
    if table_name <> 'reimbursement_receipts' then
      execute format('grant update on public.%I to authenticated', table_name);
    end if;
    if table_name = 'transactions' then
      execute format('grant delete on public.%I to authenticated', table_name);
    end if;
    execute format('create policy owner_rows on public.%I for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', table_name);
  end loop;
end;
$$;

revoke execute on function public.ledger_check_account_update(), public.ledger_check_transaction(),
  public.ledger_check_receipt(), public.ledger_check_valuation(), public.ledger_keep_definition_type() from public, anon, authenticated;

commit;
