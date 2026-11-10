begin;

alter table public.reimbursement_receipts
  add column payment_group_id uuid,
  add column payment_group_root uuid generated always as
    (case when id = payment_group_id then id end) stored,
  add constraint receipt_payment_root unique (user_id, payment_group_root, account_id, received_on),
  add constraint receipt_payment_group foreign key (user_id, payment_group_id, account_id, received_on)
    references public.reimbursement_receipts (user_id, payment_group_root, account_id, received_on)
    deferrable initially deferred,
  add constraint receipt_group_is_recorded check (payment_group_id is null or income_entry_id is null);

create unique index receipt_claim_in_payment
  on public.reimbursement_receipts (user_id, payment_group_id, expense_id, coalesce(claim_id, expense_id))
  where payment_group_id is not null;

-- A retry may reuse a receipt ID only for the original deposit.
create function public.ledger_check_receipt_group_retry() returns trigger
language plpgsql set search_path = '' as $$
begin
  if exists (
    select 1 from public.reimbursement_receipts
    where user_id = new.user_id and id = new.id and payment_group_id is distinct from new.payment_group_id
  ) then
    raise exception 'This payment was already recorded with a different group of claims.';
  end if;
  return new;
end;
$$;

create trigger receipt_group_retry before insert on public.reimbursement_receipts
  for each row execute function public.ledger_check_receipt_group_retry();
revoke execute on function public.ledger_check_receipt_group_retry() from public, anon, authenticated;

commit;
