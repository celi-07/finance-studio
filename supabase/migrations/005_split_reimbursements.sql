-- Legacy claims and payments keep their existing IDs and require no backfill.
begin;

alter table public.transactions add column reimbursement_claims jsonb;
alter table public.reimbursement_receipts
  add column claim_id uuid,
  add column income_entry_id uuid,
  add constraint reimbursement_receipts_income_entry_fkey
    foreign key (user_id, income_entry_id) references public.transactions (user_id, id);

create unique index reimbursement_receipts_linked_income
  on public.reimbursement_receipts (user_id, income_entry_id) where income_entry_id is not null;

create function public.ledger_check_claim_shares() returns trigger
language plpgsql set search_path = '' as $$
declare
  item jsonb;
  share_id uuid;
  share_ids uuid[] := '{}';
  share_amount numeric;
  claimed numeric := 0;
  payment record;
begin
  if new.reimbursement_claims is not null then
    if new.kind <> 'expense' or jsonb_typeof(new.reimbursement_claims) <> 'array' then
      raise exception 'Reimbursement shares belong to an expense.';
    end if;
    if jsonb_array_length(new.reimbursement_claims) not between 1 and 30 then
      raise exception 'Add between 1 and 30 reimbursement shares.';
    end if;
    for item in select value from jsonb_array_elements(new.reimbursement_claims) loop
      if jsonb_typeof(item) is distinct from 'object'
        or coalesce(item->>'id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or jsonb_typeof(item->'amount_minor') is distinct from 'number'
        or jsonb_typeof(item->'counterparty') is distinct from 'string'
        or length(btrim(item->>'counterparty')) not between 1 and 160 then
        raise exception 'Each share needs a name and a valid amount.';
      end if;
      share_id := (item->>'id')::uuid;
      share_amount := (item->>'amount_minor')::numeric;
      if share_id = any(share_ids) or share_amount <= 0 or share_amount <> trunc(share_amount) then
        raise exception 'Each share needs a unique ID and a positive amount.';
      end if;
      if item->>'due_on' is not null then
        if item->>'due_on' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          or (item->>'due_on')::date < new.occurred_on then
          raise exception 'Choose a due date on or after the expense date.';
        end if;
      end if;
      share_ids := array_append(share_ids, share_id);
      claimed := claimed + share_amount;
    end loop;
    if claimed <> new.reimbursable_minor or claimed > new.amount_minor then
      raise exception 'Reimbursement shares must add up to the claim and fit within the expense.';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    if row(new.kind, new.account_id, new.occurred_on, new.amount_minor)
        is distinct from row(old.kind, old.account_id, old.occurred_on, old.amount_minor)
      and exists (select 1 from public.reimbursement_receipts
        where user_id = old.user_id and income_entry_id = old.id) then
      raise exception 'Unlink the reimbursement before changing the original payment.';
    end if;

    for payment in
      select coalesce(claim_id, expense_id) as share_id, sum(amount_minor) as paid
      from public.reimbursement_receipts where user_id = old.user_id and expense_id = old.id
      group by coalesce(claim_id, expense_id)
    loop
      if new.reimbursement_claims is null then
        share_amount := case when payment.share_id = old.id then new.reimbursable_minor else 0 end;
      else
        select (value->>'amount_minor')::numeric into share_amount
        from jsonb_array_elements(new.reimbursement_claims) where value->>'id' = payment.share_id::text;
      end if;
      if coalesce(share_amount, 0) < payment.paid then
        raise exception 'Keep each paid share and its received amount, or remove its payments first.';
      end if;
    end loop;
  end if;
  return new;
end;
$$;

create trigger transaction_check_claim_shares
  before insert or update on public.transactions for each row execute function public.ledger_check_claim_shares();
revoke execute on function public.ledger_check_claim_shares() from public, anon, authenticated;

create or replace function public.ledger_check_receipt() returns trigger
language plpgsql set search_path = '' as $$
declare
  expense public.transactions%rowtype;
  income public.transactions%rowtype;
  account public.accounts%rowtype;
  prior public.reimbursement_receipts%rowtype;
  share_id uuid := coalesce(new.claim_id, new.expense_id);
  claim_amount numeric;
  received numeric;
begin
  -- Serialize payment inserts with edits to the claim or linked income.
  select * into expense from public.transactions where user_id = new.user_id and id = new.expense_id for no key update;
  if not found or expense.kind <> 'expense' or expense.reimbursable_minor <= 0 or new.received_on < expense.occurred_on
    or new.received_on > (now() at time zone 'Asia/Jakarta')::date then
    raise exception 'Choose a reimbursable expense and a payment date from the expense date through today.';
  end if;

  select * into prior from public.reimbursement_receipts where user_id = new.user_id and id = new.id;
  if found then
    if row(prior.expense_id, prior.claim_id, prior.income_entry_id, prior.account_id, prior.received_on, prior.amount_minor, prior.notes)
       is distinct from row(new.expense_id, new.claim_id, new.income_entry_id, new.account_id, new.received_on, new.amount_minor, new.notes) then
      raise exception 'This payment was already recorded with different details. Refresh the workspace before making further changes.';
    end if;
    return new;
  end if;

  if expense.reimbursement_claims is null and share_id = expense.id then
    claim_amount := expense.reimbursable_minor;
  elsif new.claim_id is not null then
    select (value->>'amount_minor')::numeric into claim_amount
    from jsonb_array_elements(expense.reimbursement_claims) where value->>'id' = share_id::text;
  end if;
  if claim_amount is null then raise exception 'Choose the person whose reimbursement you are paying.'; end if;

  if new.income_entry_id is not null then
    select * into income from public.transactions where user_id = new.user_id and id = new.income_entry_id for no key update;
    if not found or income.kind <> 'income'
      or row(income.account_id, income.occurred_on, income.amount_minor)
        is distinct from row(new.account_id, new.received_on, new.amount_minor) then
      raise exception 'Choose an income entry matching the amount, date, and deposit account.';
    end if;
  end if;

  select * into account from public.accounts where user_id = new.user_id and id = new.account_id for share;
  if not found or account.kind = 'investment' or account.archived or account.opening_date > new.received_on then
    raise exception 'Choose a cash account that was open on the payment date.';
  end if;

  select coalesce(sum(amount_minor), 0) into received from public.reimbursement_receipts
  where user_id = new.user_id and expense_id = new.expense_id and coalesce(claim_id, expense_id) = share_id;
  if new.amount_minor + received > claim_amount then raise exception 'The payment exceeds the outstanding amount for this person.'; end if;
  return new;
end;
$$;

-- The existing owner-only policy also applies to deletes.
grant delete on public.reimbursement_receipts to authenticated;

commit;
