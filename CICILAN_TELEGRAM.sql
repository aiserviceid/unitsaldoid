-- Run last after UTANG_PENCATAT_TELEGRAM.sql. Atomic payment+ledger; privacy-safe responses.
alter table public.obligation_payments add column if not exists recorder_name text;
alter table public.obligation_payments add column if not exists recorder_telegram_id text;
-- Web calls must match auth.uid(); the service-only bot still checks every related owner.
create or replace function public.prevent_cross_owner_payment()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if current_user <> 'service_role' and (auth.uid() is null or new.owner_id is distinct from auth.uid()) then raise exception 'Payment not owned by current user'; end if;
 if not exists(select 1 from public.obligations where id=new.obligation_id and owner_id=new.owner_id) then raise exception 'Obligation not owned by payment owner'; end if;
 if not exists(select 1 from public.wallets where id=new.wallet_id and owner_id=new.owner_id) then raise exception 'Wallet not owned by payment owner'; end if;
 return new;
end; $$;
drop trigger if exists obligation_payment_owner_check on public.obligation_payments;
create trigger obligation_payment_owner_check before insert or update on public.obligation_payments for each row execute function public.prevent_cross_owner_payment();
create or replace function public.bot_confirm_draft(p_draft_id uuid,p_chat_id text,p_cancel boolean default false)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare d public.telegram_drafts%rowtype; p jsonb; v_kind text; v_amount numeric; v_wallet uuid; v_dest uuid; v_cat uuid; v_tx uuid; v_ob uuid; v_name text; v_link public.telegram_links%rowtype; v_due date; v_parent public.obligations%rowtype; v_paid numeric; v_remaining numeric;
begin
 select * into d from public.telegram_drafts where id=p_draft_id and chat_id=p_chat_id for update;
 if not found then return jsonb_build_object('success',false,'message','Ringkasan tidak ditemukan.'); end if;
 -- Lock the link so revocation and confirmation are ordered atomically.
 select * into v_link from public.telegram_links where chat_id=p_chat_id and owner_id=d.owner_id and is_active for share;
 if not found then return jsonb_build_object('success',false,'message','Telegram sudah diputuskan dari akun.'); end if;
 if d.status='saved' then return jsonb_build_object('success',true,'already_saved',true,'transaction_id',d.transaction_id); end if;
 if d.status<>'pending' then return jsonb_build_object('success',false,'message','Ringkasan sudah dibatalkan atau kedaluwarsa.'); end if;
 if p_cancel then update public.telegram_drafts set status='cancelled' where id=d.id; return jsonb_build_object('success',true,'cancelled',true); end if;
 if d.expires_at<now() then update public.telegram_drafts set status='expired' where id=d.id; return jsonb_build_object('success',false,'message','Ringkasan kedaluwarsa. Kirim ulang transaksi.'); end if;
 perform 1 from public.profiles where id=d.owner_id and subscription_status<>'expired' and (expires_at is null or expires_at>now());
 if not found then return jsonb_build_object('success',false,'message','Masa aktif akun berakhir atau profil tidak tersedia.'); end if;
 p=d.payload;v_kind=p->>'kind';v_amount=(p->>'amount')::numeric;v_wallet=(p->>'wallet_id')::uuid;
 if v_kind is null or v_kind not in ('income','expense','transfer','debt_disbursement','receivable_disbursement','debt_payment','receivable_payment') or v_amount is null or v_amount<=0 or v_amount>1e12 or v_amount<>trunc(v_amount) or v_amount::text in ('NaN','Infinity','-Infinity') then raise exception 'Transaksi tidak valid'; end if;
 if coalesce(trim(p->>'description'),'')='' then raise exception 'Keterangan wajib diisi'; end if;
 perform 1 from public.wallets where id=v_wallet and owner_id=d.owner_id and is_active for share;
 if not found then raise exception 'Dompet tidak tersedia'; end if;
 if v_kind='transfer' then
  v_dest=(p->>'destination_wallet_id')::uuid;
  perform 1 from public.wallets where id=v_dest and owner_id=d.owner_id and is_active and id<>v_wallet for share;
  if not found then raise exception 'Dompet tujuan tidak valid'; end if;
 else
  v_cat=nullif(p->>'category_id','')::uuid;
  if v_cat is not null and not exists(select 1 from public.categories where id=v_cat and owner_id=d.owner_id and is_active and type=v_kind) then raise exception 'Kategori tidak valid'; end if;
 end if;
 v_name=left(coalesce(nullif(trim(p->>'recorder_name'),''),nullif(trim(v_link.first_name),''),case when v_link.username is not null then '@'||v_link.username else 'Pengguna Telegram' end),200);
 if v_kind in ('debt_disbursement','receivable_disbursement') then
  if p->>'intent' is distinct from 'obligation' or coalesce(trim(p->>'contact_name'),'')='' or p->>'obligation_type' is distinct from (case when v_kind='debt_disbursement' then 'debt' else 'receivable' end) then raise exception 'Utang/piutang tidak valid'; end if;
  v_due=nullif(p->>'due_date','')::date;
  insert into public.obligations(owner_id,type,contact_name,principal,due_date,note,status,recorder_name,recorder_telegram_id)
  values(d.owner_id,p->>'obligation_type',left(trim(p->>'contact_name'),100),v_amount,v_due,left(coalesce(p->>'due_note',''),200),'active',v_name,p_chat_id) returning id into v_ob;
 end if;
 if v_kind in ('debt_payment','receivable_payment') then
  if p->>'intent' is distinct from 'payment' then raise exception 'Pembayaran tidak valid'; end if;
  v_ob=nullif(p->>'obligation_id','')::uuid;
  select * into v_parent from public.obligations where id=v_ob and owner_id=d.owner_id and type=case when v_kind='debt_payment' then 'debt' else 'receivable' end for update;
  if not found then return jsonb_build_object('success',false,'message','Tagihan tidak tersedia. Periksa melalui web.'); end if;
  select coalesce(sum(amount),0) into v_paid from public.obligation_payments where obligation_id=v_ob;
  v_remaining=greatest(0,v_parent.principal-v_paid);
  if v_amount>v_remaining then return jsonb_build_object('success',false,'message',case when v_link.telegram_position in (1,2) then 'Pembayaran melebihi sisa tagihan: Rp '||v_remaining::text||'.' else 'Pembayaran belum dapat disimpan. Minta pemilik akun memeriksa tagihan.' end); end if;
  insert into public.obligation_payments(owner_id,obligation_id,wallet_id,amount,note,paid_at,recorder_name,recorder_telegram_id)
  values(d.owner_id,v_ob,v_wallet,v_amount,left(p->>'description',300),now(),v_name,p_chat_id);
  v_remaining=v_remaining-v_amount;
  update public.obligations set status=case when v_remaining=0 then 'paid' else 'partial' end where id=v_ob;
 end if;
 insert into public.transactions(owner_id,kind,amount,description,wallet_id,destination_wallet_id,category_id,source,external_message_id,recorder_name,recorder_telegram_id,obligation_id)
 values(d.owner_id,v_kind,v_amount,left(p->>'description',300),v_wallet,v_dest,v_cat,'telegram','telegram:'||p_chat_id||':'||d.message_id::text,v_name,p_chat_id,v_ob) returning id into v_tx;
 update public.telegram_drafts set status='saved',transaction_id=v_tx where id=d.id;
 return jsonb_build_object('success',true,'transaction_id',v_tx)||case when v_kind in ('debt_payment','receivable_payment') and v_link.telegram_position in (1,2) then jsonb_build_object('remaining',v_remaining,'contact_name',v_parent.contact_name,'obligation_type',v_parent.type) else '{}'::jsonb end;
end; $$;
revoke all on function public.bot_confirm_draft(uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.bot_confirm_draft(uuid,text,boolean) to service_role;
