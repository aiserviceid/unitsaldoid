-- The sole super admin is the verified owner account, not a client-editable field.
update public.profiles p set is_admin=(exists(select 1 from auth.users u where u.id=p.id and lower(u.email)='ai.interiorid@gmail.com' and u.email_confirmed_at is not null));
create or replace function public.is_unitsaldo_super_admin()
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from auth.users u join public.profiles p on p.id=u.id where u.id=auth.uid() and lower(u.email)='ai.interiorid@gmail.com' and u.email_confirmed_at is not null and p.is_admin);
$$;
revoke all on function public.is_unitsaldo_super_admin() from public,anon;
grant execute on function public.is_unitsaldo_super_admin() to authenticated;
create or replace function public.admin_get_all_users()
returns json language plpgsql security definer set search_path=public,pg_temp as $$
declare v_result json;
begin
 if not public.is_unitsaldo_super_admin() then raise exception 'Unauthorized: Hanya Super Admin'; end if;
 select json_agg(u) into v_result from (select id,email,full_name,subscription_status,plan,expires_at,created_at,is_admin from public.profiles order by created_at desc) u;
 return coalesce(v_result,'[]'::json);
end; $$;
create or replace function public.admin_update_license(p_target_user_id uuid,p_action text,p_days integer default 365)
returns json language plpgsql security definer set search_path=public,pg_temp as $$
declare v_exp timestamptz;v_status text;
begin
 if not public.is_unitsaldo_super_admin() then raise exception 'Unauthorized: Hanya Super Admin'; end if;
 if p_days is null or p_days<1 or p_days>3650 then raise exception 'Jumlah hari tidak valid'; end if;
 if p_action='extend' then
  update public.profiles set expires_at=greatest(now(),coalesce(expires_at,now()))+make_interval(days=>p_days),subscription_status='active',updated_at=now() where id=p_target_user_id returning expires_at,subscription_status into v_exp,v_status;
 elsif p_action in ('expire','lock') then
  update public.profiles set expires_at=now()-interval '1 hour',subscription_status='expired',updated_at=now() where id=p_target_user_id returning expires_at,subscription_status into v_exp,v_status;
 elsif p_action='trial' then
  update public.profiles set expires_at=now()+make_interval(days=>p_days),subscription_status='trial',updated_at=now() where id=p_target_user_id returning expires_at,subscription_status into v_exp,v_status;
 else raise exception 'Action tidak valid'; end if;
 if not found then raise exception 'Akun tidak ditemukan'; end if;
 return json_build_object('success',true,'user_id',p_target_user_id,'new_status',v_status,'new_expires_at',v_exp);
end; $$;
revoke all on function public.admin_get_all_users(),public.admin_update_license(uuid,text,integer) from public,anon;
grant execute on function public.admin_get_all_users(),public.admin_update_license(uuid,text,integer) to authenticated;
-- Vault is already installed in this Supabase project. These wrappers never allow browser roles.
create or replace function public.bot_config_read()
returns jsonb language sql security definer set search_path=public,pg_temp as $$
 select coalesce(jsonb_object_agg(substring(name from 15),decrypted_secret),'{}'::jsonb)
 from vault.decrypted_secrets where name in ('unitsaldo_bot_TELEGRAM_BOT_TOKEN','unitsaldo_bot_TELEGRAM_WEBHOOK_SECRET','unitsaldo_bot_GEMINI_API_KEY','unitsaldo_bot_GEMINI_MODEL');
$$;
create or replace function public.bot_config_save(p_values jsonb)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare k text;v text;v_id uuid;
begin
 perform pg_advisory_xact_lock(hashtext('unitsaldo_bot_configuration'));
 for k,v in select key,value from jsonb_each_text(p_values) loop
  if k not in ('TELEGRAM_BOT_TOKEN','TELEGRAM_WEBHOOK_SECRET','GEMINI_API_KEY','GEMINI_MODEL') then raise exception 'Configuration key not allowed'; end if;
  if v is null or char_length(v)>1024 then raise exception 'Configuration value not valid'; end if;
  if trim(v)='' then continue; end if;
  select id into v_id from vault.secrets where name='unitsaldo_bot_'||k;
  if v_id is null then perform vault.create_secret(v,'unitsaldo_bot_'||k,'UnitSaldo server configuration');
  else perform vault.update_secret(v_id,v,'unitsaldo_bot_'||k,'UnitSaldo server configuration'); end if;
 end loop;
 return true;
end; $$;
revoke all on function public.bot_config_read(),public.bot_config_save(jsonb) from public,anon,authenticated;
grant execute on function public.bot_config_read(),public.bot_config_save(jsonb) to service_role;
revoke all on vault.secrets,vault.decrypted_secrets from public,anon,authenticated;
