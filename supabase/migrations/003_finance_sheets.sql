begin;

create table public.finance_books (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 60 and lower(btrim(name)) <> 'personal'),
  unique (user_id, id)
);
create unique index finance_books_owner_name on public.finance_books (user_id, lower(btrim(name)));
alter table public.finance_books enable row level security;
revoke all on public.finance_books from public, anon, authenticated;
grant select, insert, update on public.finance_books to authenticated;
create policy finance_books_owner on public.finance_books for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Null is the original Personal sheet, so existing rows need no rewrite.
alter table public.accounts add column ledger_id uuid,
  add foreign key (user_id, ledger_id) references public.finance_books(user_id, id) deferrable initially deferred;
alter table public.categories add column ledger_id uuid,
  add foreign key (user_id, ledger_id) references public.finance_books(user_id, id) deferrable initially deferred;
alter table public.field_definitions add column ledger_id uuid,
  add foreign key (user_id, ledger_id) references public.finance_books(user_id, id) deferrable initially deferred;

drop index public.accounts_owner_name;
drop index public.categories_owner_kind_name;
drop index public.fields_owner_label;
create unique index accounts_owner_sheet_name on public.accounts (user_id, ledger_id, lower(name)) nulls not distinct;
create unique index categories_owner_sheet_kind_name on public.categories (user_id, ledger_id, applicable_kind, lower(name)) nulls not distinct;
create unique index fields_owner_sheet_label on public.field_definitions (user_id, ledger_id, lower(label)) nulls not distinct;

create function public.ledger_keep_record_sheet() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.ledger_id is distinct from old.ledger_id then raise exception 'This record must stay in its original sheet.'; end if;
  return new;
end;
$$;

create function public.ledger_check_entry_sheet() returns trigger language plpgsql set search_path = '' as $$
declare source_sheet uuid; linked_sheet uuid;
begin
  select ledger_id into source_sheet from public.accounts where user_id = new.user_id and id = new.account_id;
  if tg_op = 'UPDATE' and new.account_id <> old.account_id then
    select ledger_id into linked_sheet from public.accounts where user_id = old.user_id and id = old.account_id;
    if source_sheet is distinct from linked_sheet then raise exception 'Keep the entry in its original sheet.'; end if;
  end if;
  if new.destination_account_id is not null then
    select ledger_id into linked_sheet from public.accounts where user_id = new.user_id and id = new.destination_account_id;
    if source_sheet is distinct from linked_sheet then raise exception 'Choose a destination in the same sheet.'; end if;
  end if;
  if new.category_id is not null then
    select ledger_id into linked_sheet from public.categories where user_id = new.user_id and id = new.category_id;
    if source_sheet is distinct from linked_sheet then raise exception 'Choose a category from the same sheet.'; end if;
  end if;
  return new;
end;
$$;

create function public.ledger_check_receipt_sheet() returns trigger language plpgsql set search_path = '' as $$
declare claim_sheet uuid; deposit_sheet uuid;
begin
  select a.ledger_id into claim_sheet from public.transactions t join public.accounts a on a.user_id = t.user_id and a.id = t.account_id
    where t.user_id = new.user_id and t.id = new.expense_id;
  select ledger_id into deposit_sheet from public.accounts where user_id = new.user_id and id = new.account_id;
  if claim_sheet is distinct from deposit_sheet then raise exception 'Choose a deposit account in the claim sheet.'; end if;
  return new;
end;
$$;

create trigger account_sheet_before_update before update on public.accounts for each row execute function public.ledger_keep_record_sheet();
create trigger category_sheet_before_update before update on public.categories for each row execute function public.ledger_keep_record_sheet();
create trigger field_sheet_before_update before update on public.field_definitions for each row execute function public.ledger_keep_record_sheet();
create trigger transaction_sheet_before_write before insert or update on public.transactions for each row execute function public.ledger_check_entry_sheet();
create trigger receipt_sheet_before_write before insert or update on public.reimbursement_receipts for each row execute function public.ledger_check_receipt_sheet();

revoke execute on function public.ledger_keep_record_sheet(), public.ledger_check_entry_sheet(), public.ledger_check_receipt_sheet()
  from public, anon, authenticated;

commit;
