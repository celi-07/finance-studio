begin;

-- Historical payments settle claims while the ledger excludes them from tracked cash.
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
  if not found or account.kind = 'investment' or account.archived then
    raise exception 'Choose an active cash deposit account.';
  end if;

  select coalesce(sum(amount_minor), 0) into received from public.reimbursement_receipts
  where user_id = new.user_id and expense_id = new.expense_id and coalesce(claim_id, expense_id) = share_id;
  if new.amount_minor + received > claim_amount then raise exception 'The payment exceeds the outstanding amount for this person.'; end if;
  return new;
end;
$$;

commit;
