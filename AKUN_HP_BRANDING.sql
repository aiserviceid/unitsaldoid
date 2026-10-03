-- Genuine phone identities; no synthetic email address.
alter table public.profiles alter column email drop not null;
alter table public.profiles add column if not exists phone_number text;
alter table public.profiles add column if not exists is_special boolean not null default false;
alter table public.profiles add column if not exists brand_name text;
alter table public.profiles add column if not exists brand_theme text not null default 'unitsaldo';
create unique index if not exists profiles_phone_identity_unique on public.profiles(phone_number) where phone_number is not null;
create or replace function public.handle_new_user_setup()
returns trigger
language plpgsql
security definer set search_path=public,pg_temp
as $$
begin
  -- New accounts require owner approval.
  insert into public.profiles (id, email, phone_number, full_name, whatsapp_number, subscription_status, plan, expires_at, created_at)
  values (
    new.id,
    nullif(new.email,''),
    nullif(regexp_replace(coalesce(new.phone,''),'[^0-9]','','g'),''),
    left(nullif(trim(new.raw_user_meta_data->>'full_name'),''),100),
    case when new.phone is not null and new.phone<>'' then regexp_replace(new.phone,'[^0-9]','','g') when new.raw_user_meta_data->>'whatsapp_number' ~ '^628[0-9]{8,11}$' then new.raw_user_meta_data->>'whatsapp_number' else null end,
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
create or replace function public.admin_get_all_users()
returns json language plpgsql security definer set search_path=public,pg_temp as $$
declare v_result json;begin
 if not public.is_unitsaldo_super_admin() then raise exception 'Unauthorized: Hanya Super Admin';end if;
 select json_agg(u) into v_result from (select id,email,full_name,phone_number,whatsapp_number,is_special,brand_name,brand_theme,subscription_status,plan,expires_at,created_at,is_admin from public.profiles order by created_at desc) u;
 return coalesce(v_result,'[]'::json);
end;$$;
revoke all on function public.admin_get_all_users() from public,anon;
grant execute on function public.admin_get_all_users() to authenticated;
