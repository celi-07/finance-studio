begin;

create table public.reimbursement_people (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  ledger_id uuid,
  name text not null check (length(btrim(name)) between 1 and 70),
  archived boolean not null default false,
  foreign key (user_id, ledger_id) references public.finance_books(user_id, id)
);

create unique index reimbursement_people_owner_sheet_name
  on public.reimbursement_people (user_id, ledger_id, lower(btrim(name))) nulls not distinct;

alter table public.reimbursement_people enable row level security;
revoke all on public.reimbursement_people from public, anon, authenticated;
grant select, insert, update on public.reimbursement_people to authenticated;
create policy reimbursement_people_owner on public.reimbursement_people for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create trigger reimbursement_person_keep_sheet before update on public.reimbursement_people
  for each row execute function public.ledger_keep_record_sheet();

commit;
