begin;

-- The browser presents the challenge. The database enforces the signed session proof.
create function public.ledger_email_verified() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(
    nullif(auth.jwt()->>'email', '') is not null
    and coalesce(auth.jwt()->>'phone', '') = ''
    and (auth.jwt()->'amr') @> '[{"method":"otp"}]'::jsonb,
    false
  );
$$;
revoke all on function public.ledger_email_verified() from public, anon;
grant execute on function public.ledger_email_verified() to authenticated;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'profiles', 'finance_books', 'accounts', 'categories', 'field_definitions', 'transactions',
    'reimbursement_receipts', 'investment_valuations', 'savings_goals', 'reimbursement_people'
  ] loop
    execute format(
      'create policy email_verified_session on public.%I as restrictive for all to authenticated
       using ((select public.ledger_email_verified())) with check ((select public.ledger_email_verified()))',
      table_name
    );
  end loop;
end;
$$;

-- Keep the existing table grants. Only this owner-scoped operation may remove a whole sheet.
create function public.ledger_delete_sheet(sheet_id uuid, confirmed_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  sheet_name text;
  account_ids uuid[];
begin
  if owner_id is null or not public.ledger_email_verified() then
    raise exception 'Verify your email before deleting a sheet.';
  end if;
  select name into sheet_name from public.finance_books
    where user_id = owner_id and id = sheet_id for update;
  if not found or btrim(confirmed_name) is distinct from sheet_name then
    raise exception 'The sheet name has changed or the sheet is unavailable. Refresh and try again.';
  end if;

  select coalesce(array_agg(id), '{}'::uuid[]) into account_ids
    from public.accounts where user_id = owner_id and ledger_id = sheet_id;
  delete from public.reimbursement_receipts where user_id = owner_id and account_id = any(account_ids);
  delete from public.investment_valuations where user_id = owner_id and investment_account_id = any(account_ids);
  delete from public.transactions where user_id = owner_id and account_id = any(account_ids);
  delete from public.accounts where user_id = owner_id and ledger_id = sheet_id;
  delete from public.categories where user_id = owner_id and ledger_id = sheet_id;
  delete from public.field_definitions where user_id = owner_id and ledger_id = sheet_id;
  delete from public.savings_goals where user_id = owner_id and ledger_id = sheet_id;
  delete from public.reimbursement_people where user_id = owner_id and ledger_id = sheet_id;
  delete from public.finance_books where user_id = owner_id and id = sheet_id;
end;
$$;
revoke all on function public.ledger_delete_sheet(uuid, text) from public, anon;
grant execute on function public.ledger_delete_sheet(uuid, text) to authenticated;

commit;
