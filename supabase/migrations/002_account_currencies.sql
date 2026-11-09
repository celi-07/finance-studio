begin;

alter table public.accounts add column currency text not null default 'IDR'
  check (currency in ('IDR', 'USD', 'SGD', 'EUR', 'GBP', 'AUD', 'CAD', 'CNY', 'HKD', 'INR',
    'JPY', 'KRW', 'MYR', 'NZD', 'PHP', 'THB', 'VND', 'AED', 'CHF', 'KWD'));

create function public.ledger_keep_account_currency() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.currency is distinct from old.currency then
    raise exception 'An existing account cannot change currency.';
  end if;
  return new;
end;
$$;

create function public.ledger_check_transaction_currency() returns trigger
language plpgsql set search_path = '' as $$
declare
  source_currency text;
  prior_currency text;
  target_currency text;
begin
  select currency into source_currency from public.accounts where user_id = new.user_id and id = new.account_id;
  if tg_op = 'UPDATE' and new.account_id <> old.account_id then
    select currency into prior_currency from public.accounts where user_id = old.user_id and id = old.account_id;
    if source_currency <> prior_currency then
      raise exception 'Keep the entry in its original currency.';
    end if;
  end if;
  if new.destination_account_id is not null then
    select currency into target_currency from public.accounts where user_id = new.user_id and id = new.destination_account_id;
    if source_currency <> target_currency then
      raise exception 'Choose a destination in the same currency.';
    end if;
  end if;
  return new;
end;
$$;

create function public.ledger_check_receipt_currency() returns trigger
language plpgsql set search_path = '' as $$
declare
  claim_currency text;
  deposit_currency text;
begin
  select a.currency into claim_currency from public.transactions t
    join public.accounts a on a.user_id = t.user_id and a.id = t.account_id
    where t.user_id = new.user_id and t.id = new.expense_id;
  select currency into deposit_currency from public.accounts where user_id = new.user_id and id = new.account_id;
  if deposit_currency <> claim_currency then
    raise exception 'Choose a deposit account in the claim currency.';
  end if;
  return new;
end;
$$;

create trigger account_currency_before_update before update on public.accounts
  for each row execute function public.ledger_keep_account_currency();
create trigger transaction_currency_before_write before insert or update on public.transactions
  for each row execute function public.ledger_check_transaction_currency();
-- This runs after receipt_before_insert has locked the linked expense.
create trigger receipt_currency_before_write before insert or update on public.reimbursement_receipts
  for each row execute function public.ledger_check_receipt_currency();

revoke execute on function public.ledger_keep_account_currency(), public.ledger_check_transaction_currency(),
  public.ledger_check_receipt_currency() from public, anon, authenticated;

commit;
