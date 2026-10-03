alter table public.transactions add column if not exists external_message_id text;

-- Service-only drafts: callbacks cannot write transactions twice.
create table if not exists public.telegram_drafts (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade,
 chat_id text not null,
 message_id bigint not null,
 payload jsonb not null,
 status text not null default 'pending' check(status in ('pending','saved','cancelled','expired')),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '15 minutes',
 transaction_id uuid references public.transactions(id) on delete set null,
 unique(chat_id,message_id)
);
alter table public.telegram_drafts enable row level security;
revoke all on public.telegram_drafts from public,anon,authenticated;
grant all on public.telegram_drafts to service_role;
create index if not exists telegram_drafts_owner_created on public.telegram_drafts(owner_id,created_at);
create table if not exists public.telegram_ai_usage (
 owner_id uuid not null references auth.users(id) on delete cascade,
 day date not null,
 calls integer not null default 0,
 primary key(owner_id,day)
);
alter table public.telegram_ai_usage enable row level security;
revoke all on public.telegram_ai_usage from public,anon,authenticated;
grant all on public.telegram_ai_usage to service_role;
create or replace function public.bot_take_ai_slot(p_owner_id uuid,p_limit integer default 20)
returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_calls integer;
begin
 insert into public.telegram_ai_usage(owner_id,day,calls) values(p_owner_id,(now() at time zone 'Asia/Jakarta')::date,1)
 on conflict(owner_id,day) do update set calls=telegram_ai_usage.calls+1
 where telegram_ai_usage.calls < greatest(1,least(p_limit,100)) returning calls into v_calls;
 return v_calls is not null;
end; $$;
revoke all on function public.bot_take_ai_slot(uuid,integer) from public,anon,authenticated;
grant execute on function public.bot_take_ai_slot(uuid,integer) to service_role;
create or replace function public.bot_confirm_draft(p_draft_id uuid,p_chat_id text,p_cancel boolean default false)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare d public.telegram_drafts%rowtype; p jsonb; v_kind text; v_amount numeric; v_wallet uuid; v_dest uuid; v_cat uuid; v_tx uuid;
begin
 select * into d from public.telegram_drafts where id=p_draft_id and chat_id=p_chat_id for update;
 if not found then return jsonb_build_object('success',false,'message','Ringkasan tidak ditemukan.'); end if;
 -- Lock the link so revocation and confirmation are ordered atomically.
 perform 1 from public.telegram_links where chat_id=p_chat_id and owner_id=d.owner_id and is_active for share;
 if not found then return jsonb_build_object('success',false,'message','Telegram sudah diputuskan dari akun.'); end if;
 if d.status='saved' then return jsonb_build_object('success',true,'already_saved',true,'transaction_id',d.transaction_id); end if;
 if d.status<>'pending' then return jsonb_build_object('success',false,'message','Ringkasan sudah dibatalkan atau kedaluwarsa.'); end if;
 if p_cancel then update public.telegram_drafts set status='cancelled' where id=d.id; return jsonb_build_object('success',true,'cancelled',true); end if;
 if d.expires_at<now() then update public.telegram_drafts set status='expired' where id=d.id; return jsonb_build_object('success',false,'message','Ringkasan kedaluwarsa. Kirim ulang transaksi.'); end if;
 perform 1 from public.profiles where id=d.owner_id and subscription_status<>'expired' and (expires_at is null or expires_at>now());
 if not found then return jsonb_build_object('success',false,'message','Masa aktif akun berakhir atau profil tidak tersedia.'); end if;
 p=d.payload;v_kind=p->>'kind';v_amount=(p->>'amount')::numeric;v_wallet=(p->>'wallet_id')::uuid;
 if v_kind is null or v_kind not in ('income','expense','transfer') or v_amount is null or v_amount<=0 or v_amount>1e12 or v_amount<>trunc(v_amount) or v_amount::text in ('NaN','Infinity','-Infinity') then raise exception 'Transaksi tidak valid'; end if;
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
 insert into public.transactions(owner_id,kind,amount,description,wallet_id,destination_wallet_id,category_id,source,external_message_id)
 values(d.owner_id,v_kind,v_amount,left(p->>'description',300),v_wallet,v_dest,v_cat,'telegram','telegram:'||p_chat_id||':'||d.message_id::text) returning id into v_tx;
 update public.telegram_drafts set status='saved',transaction_id=v_tx where id=d.id;
 return jsonb_build_object('success',true,'transaction_id',v_tx);
end; $$;
revoke all on function public.bot_confirm_draft(uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.bot_confirm_draft(uuid,text,boolean) to service_role;
