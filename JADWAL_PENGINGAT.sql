-- Supabase-only: pg_cron/pg_net are not available in the offline test database.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
-- Request queue stores a scoped daily HMAC, never the Telegram webhook secret.
revoke all on schema net from public,anon,authenticated;
revoke all on all tables in schema net from public,anon,authenticated;
revoke all on all functions in schema net from public,anon,authenticated;
revoke all on schema cron from public,anon,authenticated;
create or replace function public.dispatch_unitsaldo_reminders()
returns bigint language plpgsql security definer set search_path=public,pg_temp as $$
declare s text;request_id bigint;begin
 select decrypted_secret into s from vault.decrypted_secrets where name='unitsaldo_bot_TELEGRAM_WEBHOOK_SECRET';
 if coalesce(s,'')='' then return null;end if;
 select net.http_post(url:='https://azpxkvwdmuoakipldtwa.supabase.co/functions/v1/telegram-webhook/reminders',headers:=jsonb_build_object('Content-Type','application/json','x-unitsaldo-reminder-auth',encode(extensions.hmac('unitsaldo-reminders:'||(now() at time zone 'Asia/Jakarta')::date::text,s,'sha256'),'hex')),body:='{}'::jsonb,timeout_milliseconds:=120000) into request_id;
 return request_id;
end;$$;
revoke all on function public.dispatch_unitsaldo_reminders() from public,anon,authenticated,service_role;
select cron.schedule('unitsaldo-due-reminders','* 1 * * *','select public.dispatch_unitsaldo_reminders();');
