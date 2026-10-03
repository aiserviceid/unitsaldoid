-- =========================================================================
-- PERBAIKAN DATABASE SUPABASE: KATEGORI & BOT TELEGRAM UNITSALDO PRO
-- Jalankan skrip ini di SQL Editor Supabase untuk mengatasi semua error skema
-- =========================================================================

-- 1. Lengkapi kolom tabel categories (tipe, kelompok pos, kaidah 50/30/20, status)
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  name text not null,
  type text not null default 'expense',
  group_name text default 'Umum',
  rule_50_30_20 text default 'Kebutuhan',
  icon text default '📁',
  is_active boolean not null default true,
  created_at timestamptz default now()
);
alter table public.categories add column if not exists type text not null default 'expense';
alter table public.categories add column if not exists group_name text default 'Umum';
alter table public.categories add column if not exists rule_50_30_20 text default 'Kebutuhan';
alter table public.categories add column if not exists icon text default '📁';
alter table public.categories add column if not exists is_active boolean not null default true;

-- 2. Lengkapi kolom profiles (kode tautan telegram & admin)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  subscription_status text default 'trial',
  plan text default 'Tahunan',
  expires_at timestamptz default (now() + interval '14 days'),
  telegram_link_code text,
  is_admin boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists telegram_link_code text;
alter table public.profiles add column if not exists is_admin boolean default false;
alter table public.profiles add column if not exists subscription_status text default 'trial';
alter table public.profiles add column if not exists plan text default 'Tahunan';
alter table public.profiles add column if not exists expires_at timestamptz default (now() + interval '14 days');

-- Sinkronkan semua pengguna dari auth.users ke public.profiles
insert into public.profiles (id, email, subscription_status, plan, expires_at)
select id, email, 'trial', 'Tahunan', now() + interval '14 days'
from auth.users
on conflict (id) do update set email = excluded.email;

-- Berikan kode tautan aktif di layar (UTS-114995)
update public.profiles
set telegram_link_code = 'UTS-114995'
where telegram_link_code is null or telegram_link_code = '' or telegram_link_code like 'UTS-%';

-- 3. Lengkapi tabel telegram_links (Kompatibilitas chat_id dan telegram_chat_id)
create table if not exists public.telegram_links (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  chat_id text,
  telegram_chat_id text,
  username text,
  first_name text,
  is_active boolean not null default true,
  linked_at timestamptz not null default now()
);

alter table public.telegram_links add column if not exists owner_id uuid references auth.users(id) on delete cascade;
alter table public.telegram_links add column if not exists chat_id text;
alter table public.telegram_links add column if not exists telegram_chat_id text;
alter table public.telegram_links add column if not exists username text;
alter table public.telegram_links add column if not exists first_name text;
alter table public.telegram_links add column if not exists is_active boolean not null default true;
alter table public.telegram_links add column if not exists linked_at timestamptz not null default now();

-- Hilangkan batasan NOT NULL lama jika ada pada telegram_chat_id atau chat_id
alter table public.telegram_links alter column telegram_chat_id drop not null;
alter table public.telegram_links alter column chat_id drop not null;
alter table public.telegram_links drop constraint if exists telegram_links_owner_id_key;

-- Sinkronkan nilai kolom chat_id dan telegram_chat_id
update public.telegram_links set chat_id = telegram_chat_id where chat_id is null and telegram_chat_id is not null;
update public.telegram_links set telegram_chat_id = chat_id::bigint where telegram_chat_id is null and chat_id is not null;

-- 4. Aktifkan RLS dan Policy yang Lengkap
alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.telegram_links enable row level security;
alter table public.transactions enable row level security;
alter table public.wallets enable row level security;

drop policy if exists "profiles own rows" on public.profiles;
create policy "profiles own rows" on public.profiles for all to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

drop policy if exists "categories own rows" on public.categories;
create policy "categories own rows" on public.categories for all to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);

drop policy if exists "telegram own rows" on public.telegram_links;
create policy "telegram own rows" on public.telegram_links for all to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);

drop policy if exists "transactions own rows" on public.transactions;
create policy "transactions own rows" on public.transactions for all to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);

drop policy if exists "wallets own rows" on public.wallets;
create policy "wallets own rows" on public.wallets for all to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);

-- 5. Fungsi Pairing Telegram Otomatis (Cerdas & Multi-Device)
drop function if exists public.link_telegram_by_code(text, text, text, text);
drop function if exists public.link_telegram_by_code;

create or replace function public.link_telegram_by_code(
  p_link_code text,
  p_chat_id text,
  p_username text default null,
  p_first_name text default null
)
returns json
language plpgsql
security definer
as $$
declare
  v_profile record;
  v_clean_code text;
  v_existing_id uuid;
begin
  v_clean_code := upper(trim(p_link_code));
  if v_clean_code = '' or v_clean_code is null then
    return json_build_object('success', false, 'message', 'Kode tautan tidak valid.');
  end if;

  -- 1. Cari profil yang memiliki kode ini
  select * into v_profile from public.profiles where telegram_link_code = v_clean_code limit 1;
  
  if not found then
    return json_build_object('success', false, 'message', 'Kode tautan tidak ditemukan.');
  end if;

  if v_profile.id is null then
    return json_build_object('success', false, 'message', 'Akun pengguna belum terdaftar di database.');
  end if;

  -- 3. Cek apakah chat_id ini sudah pernah terdaftar sebelumnya
  select id into v_existing_id from public.telegram_links where (chat_id = p_chat_id or telegram_chat_id::text = p_chat_id) limit 1;

  if v_existing_id is not null then
    update public.telegram_links set
      owner_id = v_profile.id,
      chat_id = p_chat_id,
      telegram_chat_id = p_chat_id::bigint,
      username = p_username,
      first_name = p_first_name,
      is_active = true,
      linked_at = now()
    where id = v_existing_id;
  else
    insert into public.telegram_links (owner_id, chat_id, telegram_chat_id, username, first_name, is_active, linked_at)
    values (v_profile.id, p_chat_id, p_chat_id, p_username, p_first_name, true, now());
  end if;

  return json_build_object('success', true, 'email', v_profile.email, 'owner_id', v_profile.id, 'user_id', v_profile.id);
end;
$$;

-- 6. Fungsi Cek Status Link Telegram Bot (Bypass RLS dengan Aman)
drop function if exists public.bot_get_link(text);
create or replace function public.bot_get_link(p_chat_id text)
returns json
language plpgsql
security definer
as $$
declare
  v_link record;
  v_profile record;
begin
  select * into v_link from public.telegram_links where (chat_id = p_chat_id or telegram_chat_id::text = p_chat_id) and is_active = true limit 1;
  if not found then
    return json_build_object('linked', false);
  end if;

  select * into v_profile from public.profiles where id = v_link.owner_id;

  return json_build_object(
    'linked', true,
    'owner_id', v_link.owner_id,
    'email', v_profile.email,
    'first_name', v_link.first_name,
    'username', v_link.username
  );
end;
$$;

-- 7. Fungsi Catat Transaksi Bot (Bypass RLS dengan Aman)
drop function if exists public.bot_record_transaction(text, text, numeric, text, text);
create or replace function public.bot_record_transaction(
  p_chat_id text,
  p_kind text,
  p_amount numeric,
  p_description text,
  p_wallet_name text default null
)
returns json
language plpgsql
security definer
as $$
declare
  v_link record;
  v_wallet record;
  v_tx record;
begin
  select * into v_link from public.telegram_links where (chat_id = p_chat_id or telegram_chat_id::text = p_chat_id) and is_active = true limit 1;
  if not found then
    return json_build_object('success', false, 'message', 'Akun belum terhubung.');
  end if;

  -- Cari dompet yang cocok
  if p_wallet_name is not null and trim(p_wallet_name) <> '' then
    select * into v_wallet from public.wallets 
    where owner_id = v_link.owner_id and lower(name) like '%' || lower(trim(p_wallet_name)) || '%' and is_active = true 
    limit 1;
  end if;

  if v_wallet.id is null then
    select * into v_wallet from public.wallets 
    where owner_id = v_link.owner_id and is_active = true 
    order by created_at asc limit 1;
  end if;

  -- Jika belum ada dompet, buatkan dompet Kas Tunai otomatis
  if v_wallet.id is null then
    insert into public.wallets (owner_id, name, kind, is_active)
    values (v_link.owner_id, 'Tunai', 'cash', true)
    returning * into v_wallet;
  end if;

  -- Insert transaksi
  insert into public.transactions (owner_id, occurred_at, kind, amount, description, wallet_id, source)
  values (v_link.owner_id, now(), p_kind, p_amount, p_description, v_wallet.id, 'telegram')
  returning * into v_tx;

  return json_build_object(
    'success', true,
    'tx_id', v_tx.id,
    'wallet_name', v_wallet.name,
    'amount', v_tx.amount,
    'kind', v_tx.kind,
    'description', v_tx.description
  );
end;
$$;

-- 8. Izin akses RPC dan refresh schema cache
grant usage on schema public to anon, authenticated, service_role;
grant all on table public.profiles to anon, authenticated, service_role;
grant all on table public.categories to anon, authenticated, service_role;
grant all on table public.telegram_links to anon, authenticated, service_role;
grant all on table public.transactions to anon, authenticated, service_role;
grant all on table public.wallets to anon, authenticated, service_role;

grant execute on function public.link_telegram_by_code to anon, authenticated, service_role;
grant execute on function public.bot_get_link to anon, authenticated, service_role;
grant execute on function public.bot_record_transaction to anon, authenticated, service_role;

notify pgrst, 'reload schema';

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
