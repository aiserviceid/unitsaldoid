-- =========================================================================
-- PERBAIKAN FITUR HAPUS TRANSAKSI, EDIT TRANSAKSI, DAN RESET DATA (ZONA BAHAYA)
-- Jalankan skrip ini di SQL Editor Supabase (Proyek: azpxkvwdmuoakipldtwa)
-- =========================================================================

begin;

-- 1. Pastikan constraint foreign key tidak memblokir penghapusan transaksi yang sah
do $$
declare
  r record;
begin
  for r in
    select conname
    from pg_constraint
    where conrelid = 'public.obligation_payments'::regclass
      and contype = 'f'
      and pg_get_constraintdef(oid) like '%transactions(id)%'
  loop
    execute format('alter table public.obligation_payments drop constraint %I', r.conname);
  end loop;
exception when others then null;
end $$;

alter table public.obligation_payments
  add column if not exists transaction_id uuid references public.transactions(id) on delete set null;

-- 2. RPC Atomik: HAPUS SATU TRANSAKSI (Mendukung semua jenis transaksi & sinkronisasi tagihan)
create or replace function public.delete_user_transaction(p_transaction_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_tx public.transactions%rowtype;
  v_ob_id uuid;
  v_paid numeric;
begin
  if v_uid is null then
    raise exception 'Silakan login terlebih dahulu.';
  end if;

  select * into v_tx
  from public.transactions
  where id = p_transaction_id and owner_id = v_uid
  for update;

  if not found then
    raise exception 'Transaksi tidak ditemukan atau bukan milik akun Anda.';
  end if;

  v_ob_id := v_tx.obligation_id;

  -- Jika transaksi merupakan pembayaran/cicilan utang atau piutang, hapus catatan cicilan terkait
  if v_tx.kind in ('debt_payment', 'receivable_payment') then
    if v_ob_id is null then
      select obligation_id into v_ob_id
      from public.obligation_payments
      where transaction_id = v_tx.id and owner_id = v_uid
      limit 1;
    end if;

    delete from public.obligation_payments
    where owner_id = v_uid
      and (
        transaction_id = v_tx.id
        or (
          transaction_id is null
          and obligation_id = v_ob_id
          and wallet_id = v_tx.wallet_id
          and amount = v_tx.amount
        )
      );
  end if;

  -- Lepaskan referensi pada telegram_drafts jika ada
  begin
    update public.telegram_drafts
    set transaction_id = null, status = 'cancelled'
    where transaction_id = v_tx.id and owner_id = v_uid;
  exception when undefined_table then null;
  end;

  -- Hapus transaksi
  delete from public.transactions
  where id = v_tx.id and owner_id = v_uid;

  -- Jika transaksi adalah pencairan utang/piutang awal, hapus tagihan jika belum ada cicilan lain,
  -- atau perbarui status tagihan jika transaksi adalah cicilan
  if v_ob_id is not null then
    if v_tx.kind in ('debt_disbursement', 'receivable_disbursement') then
      delete from public.obligation_payments where obligation_id = v_ob_id and owner_id = v_uid;
      delete from public.obligations where id = v_ob_id and owner_id = v_uid;
    else
      select coalesce(sum(amount), 0) into v_paid
      from public.obligation_payments
      where obligation_id = v_ob_id and owner_id = v_uid;

      update public.obligations
      set status = case
        when v_paid >= principal then 'paid'
        when v_paid > 0 then 'partial'
        else 'active'
      end
      where id = v_ob_id and owner_id = v_uid;
    end if;
  end if;

  return jsonb_build_object('success', true, 'deleted_id', p_transaction_id);
end;
$$;

revoke all on function public.delete_user_transaction(uuid) from public, anon;
grant execute on function public.delete_user_transaction(uuid) to authenticated, service_role;


-- 3. RPC Atomik: UBAH / EDIT TRANSAKSI (Mendukung semua jenis transaksi & sinkronisasi tagihan)
create or replace function public.update_user_transaction(
  p_transaction_id uuid,
  p_kind text,
  p_amount numeric,
  p_occurred_at timestamptz,
  p_wallet_id uuid,
  p_destination_wallet_id uuid default null,
  p_category_id uuid default null,
  p_description text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_old public.transactions%rowtype;
  v_kind text;
  v_dest uuid;
  v_cat uuid;
  v_ob_id uuid;
  v_paid numeric;
begin
  if v_uid is null then
    raise exception 'Silakan login terlebih dahulu.';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Nominal transaksi harus lebih dari 0.';
  end if;

  if coalesce(trim(p_description), '') = '' then
    raise exception 'Keterangan transaksi wajib diisi.';
  end if;

  select * into v_old
  from public.transactions
  where id = p_transaction_id and owner_id = v_uid
  for update;

  if not found then
    raise exception 'Transaksi tidak ditemukan atau bukan milik akun Anda.';
  end if;

  if not exists (select 1 from public.wallets where id = p_wallet_id and owner_id = v_uid) then
    raise exception 'Dompet tidak ditemukan.';
  end if;

  -- Jika transaksi terhubung ke utang/piutang, pertahankan jenis mutasinya agar konsisten dengan tagihan
  if v_old.kind in ('debt_disbursement', 'debt_payment', 'receivable_disbursement', 'receivable_payment') then
    v_kind := v_old.kind;
    v_dest := null;
    v_cat := null;
  else
    v_kind := coalesce(p_kind, v_old.kind);
    if v_kind not in ('income', 'expense', 'transfer') then
      raise exception 'Jenis transaksi tidak valid.';
    end if;
    if v_kind = 'transfer' then
      if p_destination_wallet_id is null or p_destination_wallet_id = p_wallet_id then
        raise exception 'Dompet asal dan tujuan transfer harus berbeda.';
      end if;
      if not exists (select 1 from public.wallets where id = p_destination_wallet_id and owner_id = v_uid) then
        raise exception 'Dompet tujuan tidak ditemukan.';
      end if;
      v_dest := p_destination_wallet_id;
      v_cat := null;
    else
      v_dest := null;
      v_cat := p_category_id;
    end if;
  end if;

  update public.transactions
  set
    kind = v_kind,
    amount = p_amount,
    occurred_at = coalesce(p_occurred_at, v_old.occurred_at),
    wallet_id = p_wallet_id,
    destination_wallet_id = v_dest,
    category_id = v_cat,
    description = trim(p_description)
  where id = p_transaction_id and owner_id = v_uid;

  -- Sinkronkan ke tabel obligations / obligation_payments bila transaksi terhubung
  v_ob_id := v_old.obligation_id;
  if v_old.kind in ('debt_payment', 'receivable_payment') then
    update public.obligation_payments
    set
      amount = p_amount,
      wallet_id = p_wallet_id,
      paid_at = coalesce(p_occurred_at, paid_at)
    where owner_id = v_uid
      and (
        transaction_id = v_old.id
        or (transaction_id is null and obligation_id = v_ob_id and amount = v_old.amount and wallet_id = v_old.wallet_id)
      );

    if v_ob_id is not null then
      select coalesce(sum(amount), 0) into v_paid
      from public.obligation_payments
      where obligation_id = v_ob_id and owner_id = v_uid;

      update public.obligations
      set status = case
        when v_paid >= principal then 'paid'
        when v_paid > 0 then 'partial'
        else 'active'
      end
      where id = v_ob_id and owner_id = v_uid;
    end if;
  elsif v_old.kind in ('debt_disbursement', 'receivable_disbursement') and v_ob_id is not null then
    select coalesce(sum(amount), 0) into v_paid
    from public.obligation_payments
    where obligation_id = v_ob_id and owner_id = v_uid;

    update public.obligations
    set
      principal = p_amount,
      status = case
        when v_paid >= p_amount then 'paid'
        when v_paid > 0 then 'partial'
        else 'active'
      end
    where id = v_ob_id and owner_id = v_uid;
  end if;

  return jsonb_build_object('success', true, 'updated_id', p_transaction_id);
end;
$$;

revoke all on function public.update_user_transaction(uuid, text, numeric, timestamptz, uuid, uuid, uuid, text) from public, anon;
grant execute on function public.update_user_transaction(uuid, text, numeric, timestamptz, uuid, uuid, uuid, text) to authenticated, service_role;


-- 4. RPC Atomik: RESET DATA KEUANGAN (ZONA BAHAYA / DANGER ZONE)
create or replace function public.reset_user_financial_data(p_scope text default 'all')
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Silakan login terlebih dahulu.';
  end if;

  if p_scope not in ('transactions', 'obligations', 'all') then
    raise exception 'Pilihan reset tidak valid.';
  end if;

  if p_scope = 'obligations' then
    delete from public.obligation_payments where owner_id = v_uid;
    delete from public.transactions
    where owner_id = v_uid
      and kind in ('debt_disbursement', 'debt_payment', 'receivable_disbursement', 'receivable_payment');
    delete from public.obligations where owner_id = v_uid;

  elsif p_scope = 'transactions' then
    begin
      delete from public.transaction_cancellations where owner_id = v_uid;
    exception when undefined_table then null;
    end;
    begin
      delete from public.transaction_history where owner_id = v_uid;
    exception when undefined_table then null;
    end;
    begin
      delete from public.telegram_drafts where owner_id = v_uid;
    exception when undefined_table then null;
    end;
    delete from public.obligation_payments where owner_id = v_uid;
    update public.obligations set status = 'active' where owner_id = v_uid;
    delete from public.transactions where owner_id = v_uid;

  elsif p_scope = 'all' then
    begin
      delete from public.transaction_cancellations where owner_id = v_uid;
    exception when undefined_table then null;
    end;
    begin
      delete from public.transaction_history where owner_id = v_uid;
    exception when undefined_table then null;
    end;
    begin
      delete from public.calendar_events where owner_id = v_uid;
    exception when undefined_table then null;
    end;
    begin
      delete from public.telegram_drafts where owner_id = v_uid;
    exception when undefined_table then null;
    end;
    delete from public.obligation_payments where owner_id = v_uid;
    delete from public.transactions where owner_id = v_uid;
    delete from public.obligations where owner_id = v_uid;
  end if;

  return jsonb_build_object('success', true, 'scope', p_scope);
end;
$$;

revoke all on function public.reset_user_financial_data(text) from public, anon;
grant execute on function public.reset_user_financial_data(text) to authenticated, service_role;

-- 5. Perbarui juga izin RLS & Grant agar fallback langsung dari web tetap berjalan lancar
grant select, insert, update, delete on public.transactions to authenticated;
grant select, insert, update, delete on public.obligations to authenticated;
grant select, insert, update, delete on public.obligation_payments to authenticated;

drop policy if exists "transactions update ordinary" on public.transactions;
drop policy if exists "transactions delete ordinary" on public.transactions;
create policy "transactions update ordinary" on public.transactions
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "transactions delete ordinary" on public.transactions
  for delete to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists "payments own rows" on public.obligation_payments;
create policy "payments own rows" on public.obligation_payments
  for all to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

notify pgrst, 'reload schema';

commit;
