alter table public.obligation_payments add column if not exists transaction_id uuid references public.transactions(id) on delete restrict;
grant select,insert,update on public.obligation_payments to service_role;
create unique index if not exists obligation_payments_transaction_unique on public.obligation_payments(transaction_id) where transaction_id is not null;
alter table public.obligation_payments disable trigger obligation_payment_owner_check;
-- Link legacy entries only when the timestamp and all financial attributes identify one pair.
with candidates as (
 select p.id pid,t.id tid,p.obligation_id,
 count(*) over(partition by p.id) pc,count(*) over(partition by t.id) tc
 from public.obligation_payments p join public.obligations o on o.id=p.obligation_id
 join public.transactions t on t.owner_id=p.owner_id and t.wallet_id=p.wallet_id and t.amount=p.amount and t.occurred_at=p.paid_at
 and t.kind=case when o.type='debt' then 'debt_payment' else 'receivable_payment' end
 and (t.obligation_id=p.obligation_id or t.obligation_id is null)
 where p.transaction_id is null and not exists(select 1 from public.obligation_payments linked where linked.transaction_id=t.id)
) update public.obligation_payments p set transaction_id=c.tid from candidates c where p.id=c.pid and c.pc=1 and c.tc=1;
alter table public.obligation_payments enable trigger obligation_payment_owner_check;
update public.transactions t set obligation_id=p.obligation_id from public.obligation_payments p where p.transaction_id=t.id and t.obligation_id is null;
create or replace function public.link_payment_transaction() returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_id uuid;v_count integer;
begin
 if new.kind in ('debt_payment','receivable_payment') and new.obligation_id is not null then
 select count(*),(array_agg(id))[1] into v_count,v_id from public.obligation_payments where owner_id=new.owner_id and obligation_id=new.obligation_id and wallet_id=new.wallet_id and amount=new.amount and paid_at=new.occurred_at and transaction_id is null;
 if v_count=1 then update public.obligation_payments set transaction_id=new.id where id=v_id;end if;
 end if;return new;
end;$$;
drop trigger if exists link_payment_transaction on public.transactions;
create trigger link_payment_transaction after insert on public.transactions for each row execute function public.link_payment_transaction();
create or replace function public.record_obligation(p_type text,p_contact_name text,p_principal numeric,p_wallet_id uuid default null,p_due_date date default null) returns json language plpgsql security definer set search_path=public,pg_temp as $$
declare v_uid uuid:=auth.uid();v_id uuid;
begin
 if v_uid is null or not public.has_unitsaldo_access() then raise exception 'Akun tidak aktif';end if;
 if p_type is null or p_type not in ('debt','receivable') then raise exception 'Jenis tidak valid';end if;
 if p_principal is null or p_principal<=0 or p_principal::text in ('NaN','Infinity','-Infinity') then raise exception 'Nominal tidak valid';end if;
 if coalesce(trim(p_contact_name),'')='' then raise exception 'Nama wajib diisi';end if;
 if p_wallet_id is not null and not exists(select 1 from public.wallets where id=p_wallet_id and owner_id=v_uid and is_active) then raise exception 'Dompet tidak ditemukan';end if;
 insert into public.obligations(owner_id,type,contact_name,principal,due_date,status) values(v_uid,p_type,trim(p_contact_name),p_principal,p_due_date,'active') returning id into v_id;
 if p_wallet_id is not null then insert into public.transactions(owner_id,kind,amount,description,wallet_id,source,obligation_id) values(v_uid,case when p_type='debt' then 'debt_disbursement' else 'receivable_disbursement' end,p_principal,case when p_type='debt' then 'Terima utang dari ' else 'Beri piutang kepada ' end||trim(p_contact_name),p_wallet_id,'web',v_id);end if;
 return json_build_object('success',true,'obligation_id',v_id);
end;$$;
create or replace function public.record_obligation_payment(p_obligation_id uuid,p_wallet_id uuid,p_amount numeric,p_note text default null) returns json language plpgsql security definer set search_path=public,pg_temp as $$
declare v_uid uuid:=auth.uid();o public.obligations%rowtype;v_paid numeric;v_pid uuid;v_tid uuid;v_status text;v_name text;
begin
 if v_uid is null or not public.has_unitsaldo_access() then raise exception 'Akun tidak aktif';end if;
 select * into o from public.obligations where id=p_obligation_id and owner_id=v_uid for update;
 if not found then raise exception 'Tagihan tidak ditemukan';end if;
 if not exists(select 1 from public.wallets where id=p_wallet_id and owner_id=v_uid and is_active) then raise exception 'Dompet tidak ditemukan';end if;
 if p_amount is null or p_amount<=0 or p_amount::text in ('NaN','Infinity','-Infinity') then raise exception 'Nominal tidak valid';end if;
 select coalesce(sum(amount),0) into v_paid from public.obligation_payments where obligation_id=o.id;
 if v_paid+p_amount>o.principal then raise exception 'Pembayaran melebihi sisa tagihan';end if;
 select coalesce(nullif(full_name,''),'Pemilik akun') into v_name from public.profiles where id=v_uid;
 insert into public.obligation_payments(owner_id,obligation_id,wallet_id,amount,note,paid_at,recorder_name) values(v_uid,o.id,p_wallet_id,p_amount,left(p_note,500),now(),v_name) returning id into v_pid;
 insert into public.transactions(owner_id,kind,amount,description,wallet_id,source,obligation_id) values(v_uid,case when o.type='debt' then 'debt_payment' else 'receivable_payment' end,p_amount,'Cicilan '||o.contact_name,p_wallet_id,'web',o.id) returning id into v_tid;
 update public.obligation_payments set transaction_id=v_tid where id=v_pid;
 v_status:=case when v_paid+p_amount>=o.principal then 'paid' else 'partial' end;
 update public.obligations set status=v_status where id=o.id;
 return json_build_object('success',true,'payment_id',v_pid,'transaction_id',v_tid,'status',v_status);
end;$$;
create table if not exists public.transaction_cancellations(
 original_transaction_id uuid primary key,owner_id uuid not null references auth.users(id) on delete cascade,
 transaction_data jsonb not null,payment_data jsonb,obligation_data jsonb,actor_chat_id text,cancelled_at timestamptz not null default now()
);
alter table public.transaction_cancellations enable row level security;
revoke all on public.transaction_cancellations from public,anon,authenticated;
grant select on public.transaction_cancellations to authenticated;
grant all on public.transaction_cancellations to service_role;
drop policy if exists "owner cancellation history" on public.transaction_cancellations;
create policy "owner cancellation history" on public.transaction_cancellations for select to authenticated using(owner_id=(select auth.uid()) and public.has_unitsaldo_access());
create or replace function public.cancel_saved_transaction(p_transaction_id uuid,p_chat_id text default null,p_confirm boolean default false) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_owner uuid;v_position integer;t public.transactions%rowtype;o public.obligations%rowtype;p public.obligation_payments%rowtype;c public.transaction_cancellations%rowtype;v_paid numeric;v_wallet text;
begin
 if p_chat_id is null then v_owner:=auth.uid();
 else
 if current_setting('role',true)<>'service_role' then raise exception 'Unauthorized';end if;
 select owner_id,telegram_position into v_owner,v_position from public.telegram_links where chat_id=p_chat_id and is_active;
 end if;
 if v_owner is null or not exists(select 1 from public.profiles where id=v_owner and subscription_status in ('trial','active') and (expires_at is null or expires_at>now())) then return jsonb_build_object('success',false,'message','Akun tidak aktif atau tidak terhubung.');end if;
 -- Serializes repeat confirms, including when the transaction has already been removed.
 perform pg_advisory_xact_lock(hashtextextended(p_transaction_id::text,0));
 select * into c from public.transaction_cancellations where original_transaction_id=p_transaction_id and owner_id=v_owner;
 if found then
 if p_chat_id is not null and coalesce(v_position,99)>2 and c.transaction_data->>'recorder_telegram_id' is distinct from p_chat_id then return jsonb_build_object('success',false,'message','Transaksi tidak ditemukan.');end if;
 return jsonb_build_object('success',true,'already_cancelled',true,'message','Transaksi sudah dibatalkan.');end if;
 select * into t from public.transactions where id=p_transaction_id and owner_id=v_owner for update;
 if not found or (p_chat_id is not null and coalesce(v_position,99)>2 and t.recorder_telegram_id is distinct from p_chat_id) then return jsonb_build_object('success',false,'message','Transaksi tidak ditemukan atau bukan pencatatan Anda.');end if;
 if t.kind in ('debt_payment','receivable_payment','debt_disbursement','receivable_disbursement') then
 if t.obligation_id is null then return jsonb_build_object('success',false,'message','Transaksi lama belum terhubung ke tagihan. Hubungi admin untuk pemeriksaan.');end if;
 select * into o from public.obligations where id=t.obligation_id and owner_id=v_owner for update;
 if not found then return jsonb_build_object('success',false,'message','Hubungan tagihan perlu diperiksa admin.');end if;
 if t.kind in ('debt_payment','receivable_payment') then
 select * into p from public.obligation_payments where transaction_id=t.id and obligation_id=o.id and owner_id=v_owner and wallet_id=t.wallet_id and amount=t.amount;
 if not found then return jsonb_build_object('success',false,'message','Cicilan lama belum terhubung secara pasti. Hubungi admin.');end if;
 else
 if exists(select 1 from public.obligation_payments where obligation_id=o.id) then return jsonb_build_object('success',false,'message','Batalkan semua cicilan tagihan ini terlebih dahulu.');end if;
 if (select count(*) from public.transactions where obligation_id=o.id)<>1 then return jsonb_build_object('success',false,'message','Tagihan memiliki transaksi lain. Periksa melalui admin.');end if;
 end if;end if;
 select name into v_wallet from public.wallets where id=t.wallet_id and owner_id=v_owner;
 if not p_confirm then return jsonb_build_object('success',true,'transaction_id',t.id,'amount',t.amount,'kind',t.kind,'description',t.description,'wallet',v_wallet,'occurred_at',t.occurred_at,'recorder_name',t.recorder_name);end if;
 insert into public.transaction_cancellations(original_transaction_id,owner_id,transaction_data,payment_data,obligation_data,actor_chat_id) values(t.id,v_owner,to_jsonb(t),case when p.id is not null then to_jsonb(p) end,case when o.id is not null then to_jsonb(o) end,p_chat_id);
 update public.telegram_drafts set status='cancelled' where transaction_id=t.id;
 if p.id is not null then
 delete from public.obligation_payments where id=p.id;
 select coalesce(sum(amount),0) into v_paid from public.obligation_payments where obligation_id=o.id;
 update public.obligations set status=case when v_paid>=principal then 'paid' when v_paid>0 then 'partial' else 'active' end where id=o.id;
 end if;
 delete from public.transactions where id=t.id;
 if o.id is not null and p.id is null then delete from public.obligations where id=o.id;end if;
 return jsonb_build_object('success',true,'cancelled',true,'message','Transaksi dibatalkan. Saldo dan tagihan sudah disinkronkan.');
end;$$;
revoke all on function public.cancel_saved_transaction(uuid,text,boolean) from public,anon;
grant execute on function public.cancel_saved_transaction(uuid,text,boolean) to authenticated,service_role;
revoke all on function public.record_obligation(text,text,numeric,uuid,date),public.record_obligation_payment(uuid,uuid,numeric,text) from public,anon;
grant execute on function public.record_obligation(text,text,numeric,uuid,date),public.record_obligation_payment(uuid,uuid,numeric,text) to authenticated;
