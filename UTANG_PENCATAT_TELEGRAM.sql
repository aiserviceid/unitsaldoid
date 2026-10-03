-- Apply after BOT_TELEGRAM.sql and PRIVASI_TELEGRAM.sql. Trusted bot sender snapshots.
alter table public.transactions add column if not exists recorder_name text;
alter table public.transactions add column if not exists recorder_telegram_id text;
alter table public.transactions add column if not exists obligation_id uuid references public.obligations(id) on delete set null;
alter table public.obligations add column if not exists recorder_name text;
alter table public.obligations add column if not exists recorder_telegram_id text;
-- Historical messages have no sender snapshot; use the currently linked name when available.
update public.transactions t set recorder_name=coalesce(nullif(l.first_name,''),case when l.username is not null then '@'||l.username else 'Pengguna Telegram' end),recorder_telegram_id=l.chat_id
from public.telegram_links l where t.source='telegram' and t.recorder_name is null
and t.owner_id=l.owner_id and split_part(t.external_message_id,':',2)=l.chat_id;
create or replace function public.bot_confirm_draft(p_draft_id uuid,p_chat_id text,p_cancel boolean default false)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare d public.telegram_drafts%rowtype; p jsonb; v_kind text; v_amount numeric; v_wallet uuid; v_dest uuid; v_cat uuid; v_tx uuid; v_ob uuid; v_name text; v_link public.telegram_links%rowtype; v_due date;
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
 if v_kind is null or v_kind not in ('income','expense','transfer','debt_disbursement','receivable_disbursement') or v_amount is null or v_amount<=0 or v_amount>1e12 or v_amount<>trunc(v_amount) or v_amount::text in ('NaN','Infinity','-Infinity') then raise exception 'Transaksi tidak valid'; end if;
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
 insert into public.transactions(owner_id,kind,amount,description,wallet_id,destination_wallet_id,category_id,source,external_message_id,recorder_name,recorder_telegram_id,obligation_id)
 values(d.owner_id,v_kind,v_amount,left(p->>'description',300),v_wallet,v_dest,v_cat,'telegram','telegram:'||p_chat_id||':'||d.message_id::text,v_name,p_chat_id,v_ob) returning id into v_tx;
 update public.telegram_drafts set status='saved',transaction_id=v_tx where id=d.id;
 return jsonb_build_object('success',true,'transaction_id',v_tx);
end; $$;
revoke all on function public.bot_confirm_draft(uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.bot_confirm_draft(uuid,text,boolean) to service_role;
