-- Apply after AKTIVASI_AKUN.sql. Immutable history starts when this migration is applied.
alter table public.profiles add column if not exists telegram_reminders_enabled boolean not null default true;
grant update(telegram_reminders_enabled) on public.profiles to authenticated;
create table if not exists public.transaction_history(
 id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id) on delete cascade,
 transaction_id uuid not null,operation text not null check(operation in ('created','updated','deleted')),
 actor_user_id uuid,actor_telegram_id text,actor_name text not null,changed_at timestamptz not null default now(),
 before_data jsonb,after_data jsonb
);
create index if not exists transaction_history_owner_time on public.transaction_history(owner_id,changed_at desc);
alter table public.transaction_history enable row level security;
revoke all on public.transaction_history from public,anon,authenticated;
grant select on public.transaction_history to authenticated;
grant all on public.transaction_history to service_role;
drop policy if exists history_owner_read on public.transaction_history;
create policy history_owner_read on public.transaction_history for select to authenticated using(owner_id=auth.uid() and public.has_unitsaldo_access());
create or replace function public.unitsaldo_stamp_transaction() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare n text;begin
 if current_setting('role',true)='authenticated' then
  if auth.uid() is null or new.owner_id is distinct from auth.uid() then raise exception 'Unauthorized transaction';end if;
  if tg_op='UPDATE' and (old.kind in ('debt_disbursement','debt_payment','receivable_disbursement','receivable_payment') or new.kind in ('debt_disbursement','debt_payment','receivable_disbursement','receivable_payment')) then raise exception 'Gunakan menu Utang & Piutang untuk transaksi terhubung';end if;
  if tg_op='INSERT' then
   select coalesce(nullif(trim(full_name),''),split_part(email,'@',1),'Pemilik akun') into n from public.profiles where id=auth.uid();
   new.source:='web';new.recorder_name:=coalesce(n,'Pemilik akun');new.recorder_telegram_id:=null;
  else
   new.source:=old.source;new.recorder_name:=old.recorder_name;new.recorder_telegram_id:=old.recorder_telegram_id;
  end if;
 end if;
 return new;
end;$$;
revoke all on function public.unitsaldo_stamp_transaction() from public,anon,authenticated;
drop trigger if exists unitsaldo_stamp_transaction on public.transactions;
create trigger unitsaldo_stamp_transaction before insert or update on public.transactions for each row execute function public.unitsaldo_stamp_transaction();
create or replace function public.unitsaldo_audit_transaction() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare row_data jsonb;before_row jsonb;after_row jsonb;actor text;actor_uid uuid;actor_tg text;begin
 if tg_op='UPDATE' and to_jsonb(old)=to_jsonb(new) then return new;end if;
 if tg_op<>'INSERT' then before_row:=to_jsonb(old);end if;
 if tg_op<>'DELETE' then after_row:=to_jsonb(new);end if;
 row_data:=coalesce(after_row,before_row);
 if current_setting('role',true)='authenticated' or (auth.uid() is not null and current_setting('role',true)<>'service_role') then
  actor_uid:=auth.uid();select coalesce(nullif(trim(full_name),''),split_part(email,'@',1),'Pemilik akun') into actor from public.profiles where id=actor_uid;
 elsif row_data->>'source'='telegram' then actor:=row_data->>'recorder_name';actor_tg:=row_data->>'recorder_telegram_id';
 else actor:='Sistem';end if;
 insert into public.transaction_history(owner_id,transaction_id,operation,actor_user_id,actor_telegram_id,actor_name,before_data,after_data)
 values((row_data->>'owner_id')::uuid,(row_data->>'id')::uuid,case tg_op when 'INSERT' then 'created' when 'UPDATE' then 'updated' else 'deleted' end,actor_uid,actor_tg,coalesce(actor,'Nama belum tersedia'),before_row,after_row);
 if tg_op='DELETE' then return old;else return new;end if;
end;$$;
revoke all on function public.unitsaldo_audit_transaction() from public,anon,authenticated;
drop trigger if exists unitsaldo_audit_transaction on public.transactions;
create trigger unitsaldo_audit_transaction after insert or update or delete on public.transactions for each row execute function public.unitsaldo_audit_transaction();

-- One reminder per chat per WIB day; only slots 1/2 can ever read financial details.
create table if not exists public.telegram_reminder_deliveries(
 id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id) on delete cascade,
 chat_id text not null,reminder_date date not null,status text not null default 'sending' check(status in ('sending','sent','failed','skipped','uncertain')),
 attempts integer not null default 1,claimed_at timestamptz not null default now(),sent_at timestamptz,message_id text,
 unique(chat_id,reminder_date)
);
alter table public.telegram_reminder_deliveries enable row level security;
revoke all on public.telegram_reminder_deliveries from public,anon,authenticated;
grant all on public.telegram_reminder_deliveries to service_role;
create or replace function public.bot_reminder_tags(p_owner_id uuid,p_today date)
returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(jsonb_build_object('name',contact_name,'type',type,'due_date',due_date,'remaining',remaining) order by due_date,contact_name),'[]'::jsonb)
 from (select o.contact_name,o.type,o.due_date,greatest(0,o.principal-coalesce((select sum(amount) from public.obligation_payments p where p.obligation_id=o.id and p.owner_id=o.owner_id),0)) remaining
 from public.obligations o where o.owner_id=p_owner_id and o.due_date is not null and o.status<>'paid' and (o.due_date=p_today+3 or o.due_date=p_today or (o.due_date<p_today and (p_today-o.due_date)%7=1))) tags where remaining>0;
$$;
create or replace function public.bot_claim_due_reminders(p_now timestamptz default now())
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare l record;v_id uuid;v_today date:=(p_now at time zone 'Asia/Jakarta')::date;v_tasks jsonb:='[]';begin
 -- No accidental night-time sends. Cron runs during 08:00-08:59 WIB.
 if extract(hour from p_now at time zone 'Asia/Jakarta')<>8 then return v_tasks;end if;
 perform pg_advisory_xact_lock(hashtext('unitsaldo_due_reminders'));
 for l in select t.owner_id,t.chat_id from public.telegram_links t join public.profiles p on p.id=t.owner_id
 where t.is_active and t.telegram_position in (1,2) and p.telegram_reminders_enabled and p.subscription_status in ('trial','active') and (p.expires_at is null or p.expires_at>now())
 and public.bot_reminder_tags(t.owner_id,v_today)<>'[]'::jsonb
 and not exists(select 1 from public.telegram_reminder_deliveries d where d.chat_id=t.chat_id and d.reminder_date=v_today and (d.status in ('sent','skipped','uncertain','sending') or d.attempts>=3))
 order by t.owner_id,t.chat_id limit 10 loop
  v_id:=null;
  insert into public.telegram_reminder_deliveries(owner_id,chat_id,reminder_date) values(l.owner_id,l.chat_id,v_today)
  on conflict(chat_id,reminder_date) do update set status='sending',attempts=telegram_reminder_deliveries.attempts+1,claimed_at=now() where telegram_reminder_deliveries.status='failed' and telegram_reminder_deliveries.attempts<3
  returning id into v_id;
  if v_id is not null then v_tasks:=v_tasks||jsonb_build_array(jsonb_build_object('id',v_id));end if;
 end loop;
 return v_tasks;
end;$$;
create or replace function public.bot_reminder_payload(p_delivery_id uuid)
returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
 select jsonb_build_object('chat_id',d.chat_id,'date',d.reminder_date,'tags',public.bot_reminder_tags(d.owner_id,d.reminder_date))
 from public.telegram_reminder_deliveries d join public.telegram_links t on t.owner_id=d.owner_id and t.chat_id=d.chat_id join public.profiles p on p.id=d.owner_id
 where d.id=p_delivery_id and d.status='sending' and d.reminder_date=(now() at time zone 'Asia/Jakarta')::date and t.is_active and t.telegram_position in (1,2) and p.telegram_reminders_enabled and p.subscription_status in ('trial','active') and (p.expires_at is null or p.expires_at>now());
$$;
create or replace function public.bot_finish_reminder(p_delivery_id uuid,p_status text,p_message_id text default null)
returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if p_status not in ('sent','failed','skipped','uncertain') then raise exception 'Invalid reminder state';end if;
 update public.telegram_reminder_deliveries set status=p_status,sent_at=case when p_status='sent' then now() else null end,message_id=p_message_id where id=p_delivery_id and status='sending';return found;
end;$$;
revoke all on function public.bot_reminder_tags(uuid,date),public.bot_claim_due_reminders(timestamptz),public.bot_reminder_payload(uuid),public.bot_finish_reminder(uuid,text,text) from public,anon,authenticated;
grant execute on function public.bot_reminder_tags(uuid,date),public.bot_claim_due_reminders(timestamptz),public.bot_reminder_payload(uuid),public.bot_finish_reminder(uuid,text,text) to service_role;
