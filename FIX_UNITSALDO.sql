-- UnitSaldo: jalankan setelah skema lama tersedia. Tidak menghapus transaksi.
begin;

-- Compatibility with earlier ArusKasKu schemas.
alter table public.telegram_links add column if not exists telegram_chat_id bigint;
create or replace function public.sync_category_flow()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  if TG_OP='INSERT' then
    if new.flow is null then new.flow:=coalesce(new.type,'expense'); else new.type:=new.flow; end if;
  elsif new.type is distinct from old.type then new.flow:=new.type;
  elsif new.flow is distinct from old.flow then new.type:=new.flow;
  end if;
  return new;
end; $$;
-- Fresh schemas do not have flow; add it without rewriting existing category types.
alter table public.categories add column if not exists flow text;
drop trigger if exists sync_category_flow on public.categories;
create trigger sync_category_flow before insert or update on public.categories for each row execute function public.sync_category_flow();

-- The bot must use its server credentials, never anonymous table access.
drop policy if exists "allow anon bot select profiles" on public.profiles;
drop policy if exists "allow anon bot select wallets" on public.wallets;
drop policy if exists "allow anon bot insert transactions" on public.transactions;
drop policy if exists "allow anon bot select telegram" on public.telegram_links;
revoke all on public.profiles,public.wallets,public.categories,public.transactions,public.obligations,public.obligation_payments,public.telegram_links from anon;


create or replace function public.record_obligation_payment(
  p_obligation_id uuid,
  p_wallet_id uuid,
  p_amount numeric,
  p_note text default ''
)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_ob record;
  v_total_paid numeric;
  v_new_total numeric;
  v_new_status text;
  v_tx_kind text;
  v_payment_id uuid;
begin
  if v_user_id is null then
    raise exception 'Unauthorized';
  end if;

  if p_amount is null or p_amount <= 0 or p_amount::text in ('NaN','Infinity','-Infinity') then
    raise exception 'Nominal pembayaran harus lebih besar dari 0';
  end if;

  select * into v_ob from public.obligations where id = p_obligation_id and owner_id = v_user_id for update;
  if not found then
    raise exception 'Data utang/piutang tidak ditemukan';
  end if;

  if not exists (select 1 from public.wallets where id=p_wallet_id and owner_id=v_user_id and is_active) then
    raise exception 'Dompet tidak ditemukan';
  end if;

  select coalesce(sum(amount), 0) into v_total_paid from public.obligation_payments where obligation_id = p_obligation_id;
  v_new_total := v_total_paid + p_amount;

  if v_new_total > v_ob.principal then
    raise exception 'Nominal melebihi sisa tagihan (Maksimal: %)', (v_ob.principal - v_total_paid);
  end if;

  if v_new_total >= v_ob.principal then
    v_new_status := 'paid';
  else
    v_new_status := 'partial';
  end if;

  -- Tentukan jenis mutasi transaksi kas
  if v_ob.type = 'debt' then
    v_tx_kind := 'debt_payment'; -- Mengurangi saldo dompet
  else
    v_tx_kind := 'receivable_payment'; -- Menambah saldo dompet
  end if;

  -- 1. Catat ke tabel obligation_payments
  insert into public.obligation_payments (owner_id, obligation_id, wallet_id, amount, note, paid_at)
  values (v_user_id, p_obligation_id, p_wallet_id, p_amount, coalesce(p_note, ''), now())
  returning id into v_payment_id;

  -- 2. Update status obligation
  update public.obligations set status = v_new_status where id = p_obligation_id;

  -- 3. Catat mutasi otomatis ke transactions
  insert into public.transactions (
    owner_id, occurred_at, kind, amount, description, wallet_id, source
  ) values (
    v_user_id,
    now(),
    v_tx_kind,
    p_amount,
    case when v_ob.type = 'debt' then 'Bayar utang ke ' || v_ob.contact_name else 'Terima piutang dari ' || v_ob.contact_name end || case when coalesce(p_note,'') <> '' then ' (' || p_note || ')' else '' end,
    p_wallet_id,
    'web'
  );

  return json_build_object('success', true, 'payment_id', v_payment_id, 'status', v_new_status);
end;
$$;


-- Catat tagihan dan mutasi awal dalam satu transaksi database.
create or replace function public.record_obligation(
  p_type text, p_contact_name text, p_principal numeric,
  p_wallet_id uuid default null, p_due_date date default null
) returns json language plpgsql security definer
set search_path=public,pg_temp as $$
declare v_uid uuid := auth.uid(); v_id uuid;
begin
  if v_uid is null then raise exception 'Unauthorized'; end if;
  if p_type not in ('debt','receivable') or p_type is null then raise exception 'Jenis tidak valid'; end if;
  if p_principal is null or p_principal <= 0 or p_principal::text in ('NaN','Infinity','-Infinity') then raise exception 'Nominal tidak valid'; end if;
  if coalesce(trim(p_contact_name),'') = '' then raise exception 'Nama wajib diisi'; end if;
  if p_wallet_id is not null and not exists(select 1 from public.wallets where id=p_wallet_id and owner_id=v_uid and is_active) then raise exception 'Dompet tidak ditemukan'; end if;
  insert into public.obligations(owner_id,type,contact_name,principal,due_date,status)
    values(v_uid,p_type,trim(p_contact_name),p_principal,p_due_date,'active') returning id into v_id;
  if p_wallet_id is not null then
    insert into public.transactions(owner_id,kind,amount,description,wallet_id,source)
    values(v_uid,case when p_type='debt' then 'debt_disbursement' else 'receivable_disbursement' end,
      p_principal,case when p_type='debt' then 'Terima utang dari ' else 'Beri piutang kepada ' end || trim(p_contact_name),p_wallet_id,'web');
  end if;
  return json_build_object('success',true,'obligation_id',v_id);
end; $$;
revoke all on function public.record_obligation(text,text,numeric,uuid,date) from public,anon;
grant execute on function public.record_obligation(text,text,numeric,uuid,date) to authenticated;
revoke all on function public.record_obligation_payment(uuid,uuid,numeric,text) from public,anon;
grant execute on function public.record_obligation_payment(uuid,uuid,numeric,text) to authenticated;

-- A user can change their display name and pairing code, not their license/admin flag.
revoke insert,update,delete on public.profiles from anon,authenticated;
grant select on public.profiles to authenticated;
grant update(full_name,telegram_link_code,updated_at) on public.profiles to authenticated;
revoke insert,update,delete on public.obligation_payments from anon,authenticated;
grant select on public.obligation_payments to authenticated;

-- Validate ownership of related records as well as owner_id.
create or replace function public.validate_transaction_links()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  if not exists(select 1 from public.wallets where id=new.wallet_id and owner_id=new.owner_id) then raise exception 'Dompet bukan milik pengguna'; end if;
  if new.kind='transfer' and (new.destination_wallet_id is null or new.destination_wallet_id=new.wallet_id) then raise exception 'Dompet transfer tidak valid'; end if;
  if new.destination_wallet_id is not null and not exists(select 1 from public.wallets where id=new.destination_wallet_id and owner_id=new.owner_id) then raise exception 'Dompet tujuan bukan milik pengguna'; end if;
  if new.category_id is not null and not exists(select 1 from public.categories where id=new.category_id and owner_id=new.owner_id) then raise exception 'Kategori bukan milik pengguna'; end if;
  return new;
end; $$;
drop trigger if exists validate_transaction_links on public.transactions;
create trigger validate_transaction_links before insert or update on public.transactions for each row execute function public.validate_transaction_links();

-- Protect linked ledger transactions against independent editing/removal by users.
drop policy if exists "transactions own rows" on public.transactions;
drop policy if exists "transactions read own" on public.transactions;
drop policy if exists "transactions insert own" on public.transactions;
drop policy if exists "transactions update ordinary" on public.transactions;
drop policy if exists "transactions delete ordinary" on public.transactions;
create policy "transactions read own" on public.transactions for select to authenticated using ((select auth.uid())=owner_id);
create policy "transactions insert own" on public.transactions for insert to authenticated with check ((select auth.uid())=owner_id and kind in ('income','expense','transfer'));
create policy "transactions update ordinary" on public.transactions for update to authenticated using ((select auth.uid())=owner_id and kind in ('income','expense','transfer')) with check ((select auth.uid())=owner_id and kind in ('income','expense','transfer'));
create policy "transactions delete ordinary" on public.transactions for delete to authenticated using ((select auth.uid())=owner_id and kind in ('income','expense','transfer'));

-- Consume pairing codes once. Only the trusted bot server can submit chat IDs.
create or replace function public.link_telegram_by_code(p_link_code text,p_chat_id text,p_username text default null,p_first_name text default null)
returns json language plpgsql security definer set search_path=public,pg_temp as $$
declare v_profile public.profiles%rowtype;
begin
  if coalesce(trim(p_chat_id),'')='' or coalesce(trim(p_link_code),'')='' then return json_build_object('success',false,'message','Kode tidak valid'); end if;
  select * into v_profile from public.profiles where telegram_link_code=upper(trim(p_link_code)) for update;
  if not found then return json_build_object('success',false,'message','Kode tidak ditemukan atau sudah digunakan'); end if;
  -- One chat may belong to only one account; the old link is removed deliberately.
  delete from public.telegram_links where chat_id=p_chat_id;
  insert into public.telegram_links(owner_id,chat_id,telegram_chat_id,username,first_name,is_active,linked_at)
    values(v_profile.id,p_chat_id,p_chat_id::bigint,p_username,p_first_name,true,now());
  update public.profiles set telegram_link_code=null where id=v_profile.id;
  return json_build_object('success',true,'owner_id',v_profile.id,'email',v_profile.email);
end; $$;
-- Old deployments may have a unique(owner_id) constraint which blocked multiple chats.
do $$ declare c record; begin
  for c in select conname from pg_constraint where conrelid='public.telegram_links'::regclass and contype='u' and conkey=array[(select attnum from pg_attribute where attrelid='public.telegram_links'::regclass and attname='owner_id')]::smallint[]
  loop execute format('alter table public.telegram_links drop constraint %I',c.conname); end loop;
end $$;
revoke all on function public.link_telegram_by_code(text,text,text,text) from public,anon,authenticated;
grant execute on function public.link_telegram_by_code(text,text,text,text) to service_role;
-- Revoke dangerous public access left by earlier bot fixes, if those functions exist.
do $$ declare f record; begin
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('bot_get_link','bot_record_transaction')
  loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
    execute format('alter function %s set search_path=public,pg_temp',f.signature);
  end loop;
end $$;
alter function public.handle_new_user_setup() set search_path=public,pg_temp;
alter function public.admin_get_all_users() set search_path=public,pg_temp;
alter function public.admin_update_license(uuid,text,integer) set search_path=public,pg_temp;
revoke execute on function public.admin_get_all_users(),public.admin_update_license(uuid,text,integer) from public,anon;
grant execute on function public.admin_get_all_users(),public.admin_update_license(uuid,text,integer) to authenticated;
revoke execute on function public.handle_new_user_setup() from public,anon,authenticated;
commit;
