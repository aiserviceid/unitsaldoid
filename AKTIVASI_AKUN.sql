-- Apply last. Existing profiles remain unchanged.
alter table public.profiles add column if not exists whatsapp_number text;
alter table public.profiles alter column subscription_status set default 'pending';
alter table public.profiles alter column expires_at drop default;
alter table public.profiles alter column expires_at drop not null;
do $$ declare c record; begin for c in select conname from pg_constraint where conrelid='public.profiles'::regclass and contype='c' and pg_get_constraintdef(oid) like '%subscription_status%' loop execute format('alter table public.profiles drop constraint %I',c.conname); end loop; end $$;
alter table public.profiles add constraint profiles_subscription_status_check check(subscription_status in ('pending','trial','active','expired','cancelled'));
create or replace function public.handle_new_user_setup()
returns trigger
language plpgsql
security definer set search_path=public,pg_temp
as $$
begin
  -- New accounts require owner approval.
  insert into public.profiles (id, email, full_name, whatsapp_number, subscription_status, plan, expires_at, created_at)
  values (
    new.id,
    new.email,
    left(nullif(trim(new.raw_user_meta_data->>'full_name'),''),100),
    case when new.raw_user_meta_data->>'whatsapp_number' ~ '^628[0-9]{8,11}$' then new.raw_user_meta_data->>'whatsapp_number' else null end,
    'pending',
    'Tahunan',
    null,
    now()
  ) on conflict (id) do nothing;

  -- 2. Buat dompet awal default
  insert into public.wallets (owner_id, name, kind)
  values 
    (new.id, 'Tunai / Cash', 'cash'),
    (new.id, 'Rekening Bank', 'bank')
  on conflict do nothing;

  -- 3. Buat kategori dasar pengeluaran & pemasukan
  insert into public.categories (owner_id, name, type, icon)
  values
    (new.id, 'Makanan & Minuman', 'expense', '🍔'),
    (new.id, 'Transportasi & Bensin', 'expense', '⛽'),
    (new.id, 'Belanja Kebutuhan', 'expense', '🛒'),
    (new.id, 'Tagihan & Listrik/Air', 'expense', '⚡'),
    (new.id, 'Gaji / Upah', 'income', '💼'),
    (new.id, 'Hasil Usaha / Penjualan', 'income', '🏪'),
    (new.id, 'Bonus & Lain-lain', 'income', '🎁')
  on conflict do nothing;

  return new;
end;
$$;
revoke all on function public.handle_new_user_setup() from public,anon,authenticated;
create or replace function public.has_unitsaldo_access() returns boolean language sql stable security invoker set search_path=public,pg_temp as $$
 select public.is_unitsaldo_super_admin() or exists(select 1 from public.profiles where id=auth.uid() and subscription_status in ('trial','active') and (expires_at is null or expires_at>now()));
$$;
revoke all on function public.has_unitsaldo_access() from public,anon;
grant execute on function public.has_unitsaldo_access() to authenticated;
do $$ declare t text; begin foreach t in array array['wallets','categories','transactions','obligations','obligation_payments','telegram_links'] loop
 execute format('drop policy if exists unitsaldo_activation_required on public.%I',t);
 execute format('create policy unitsaldo_activation_required on public.%I as restrictive for all to authenticated using(public.has_unitsaldo_access()) with check(public.has_unitsaldo_access())',t);
end loop; end $$;
do $$ declare f record; d text; begin
 for f in select oid from pg_proc where pronamespace='public'::regnamespace and proname in ('record_obligation','record_obligation_payment') loop
 d:=pg_get_functiondef(f.oid);
 if position('has_unitsaldo_access' in d)=0 then d:=regexp_replace(d,'\mbegin\M', E'begin\n if not public.has_unitsaldo_access() then raise exception ''Akun belum aktif. Hubungi admin untuk aktivasi.''; end if;', 'i');execute d;end if;
 end loop; end $$;
create or replace function public.admin_get_all_users()
returns json language plpgsql security definer set search_path=public,pg_temp as $$
declare v_result json;
begin
 if not public.is_unitsaldo_super_admin() then raise exception 'Unauthorized: Hanya Super Admin'; end if;
 select json_agg(u) into v_result from (select id,email,full_name,whatsapp_number,subscription_status,plan,expires_at,created_at,is_admin from public.profiles order by created_at desc) u;
 return coalesce(v_result,'[]'::json);
end; $$;
create or replace function public.link_telegram_by_code(p_link_code text,p_chat_id text,p_username text default null,p_first_name text default null)
returns json language plpgsql security definer set search_path=public,pg_temp as $$
declare v_profile public.profiles%rowtype; v_link public.telegram_links%rowtype; v_position integer;
begin
 if coalesce(trim(p_chat_id),'')='' or coalesce(trim(p_link_code),'')='' then return json_build_object('success',false,'message','Kode tidak valid'); end if;
 -- Serializes allocation and single-use code consumption within this family.
 select * into v_profile from public.profiles where telegram_link_code=upper(trim(p_link_code)) for update;
 if not found then return json_build_object('success',false,'message','Kode tidak ditemukan atau sudah digunakan'); end if;
 if v_profile.subscription_status not in ('trial','active') or (v_profile.expires_at is not null and v_profile.expires_at<=now()) then return json_build_object('success',false,'message','Akun belum aktif. Hubungi admin melalui web.'); end if;
 select * into v_link from public.telegram_links where chat_id=p_chat_id for update;
 if found and v_link.owner_id=v_profile.id and v_link.telegram_position is not null then
  v_position:=v_link.telegram_position;
  update public.telegram_links set username=p_username,first_name=p_first_name,is_active=true where id=v_link.id;
 else
  select coalesce(max(telegram_position),0)+1 into v_position from public.telegram_links where owner_id=v_profile.id;
  delete from public.telegram_links where chat_id=p_chat_id;
  insert into public.telegram_links(owner_id,chat_id,telegram_chat_id,username,first_name,is_active,linked_at,telegram_position)
   values(v_profile.id,p_chat_id,p_chat_id::bigint,p_username,p_first_name,true,now(),v_position);
 end if;
 update public.profiles set telegram_link_code=null where id=v_profile.id;
 return json_build_object('success',true,'owner_id',v_profile.id,'telegram_position',v_position,'can_view_finances',v_position in (1,2));
end; $$;
revoke all on function public.link_telegram_by_code(text,text,text,text) from public,anon,authenticated;
grant execute on function public.link_telegram_by_code(text,text,text,text) to service_role;
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
 perform 1 from public.profiles where id=d.owner_id and subscription_status in ('trial','active') and (expires_at is null or expires_at>now());
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
