-- Owner-only Telegram labels and atomic slot exchange, respecting existing RLS.
alter table public.telegram_links add column if not exists display_name text;
create unique index if not exists telegram_family_position_unique on public.telegram_links(owner_id,telegram_position);
create or replace function public.edit_telegram_member(p_link_id uuid,p_display_name text,p_position integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_owner uuid:=auth.uid(); v_link public.telegram_links%rowtype; v_other public.telegram_links%rowtype; v_temp integer; v_name text:=trim(coalesce(p_display_name,''));
begin
 if v_owner is null then raise exception 'Silakan masuk ke akun'; end if;
 if char_length(v_name)<1 or char_length(v_name)>80 then raise exception 'Nama harus 1–80 karakter'; end if;
 perform 1 from public.profiles where id=v_owner for update;
 if not found then raise exception 'Akun tidak ditemukan'; end if;
 select * into v_link from public.telegram_links where id=p_link_id and owner_id=v_owner and is_active for update;
 if not found then raise exception 'Telegram tidak ditemukan atau sudah diputuskan'; end if;
 if p_position is null or (p_position not in (1,2,3) and p_position is distinct from v_link.telegram_position) then raise exception 'Pilih Telegram 1, 2, atau 3'; end if;
 if p_position is distinct from v_link.telegram_position then
  select * into v_other from public.telegram_links where owner_id=v_owner and telegram_position=p_position and id<>p_link_id for update;
  if found then
   select coalesce(max(telegram_position),0)+1 into v_temp from public.telegram_links where owner_id=v_owner;
   update public.telegram_links set telegram_position=v_temp where id=v_other.id and owner_id=v_owner;
   update public.telegram_links set telegram_position=p_position,display_name=v_name where id=p_link_id and owner_id=v_owner;
   update public.telegram_links set telegram_position=v_link.telegram_position where id=v_other.id and owner_id=v_owner;
  else
   update public.telegram_links set telegram_position=p_position,display_name=v_name where id=p_link_id and owner_id=v_owner;
  end if;
 else
  update public.telegram_links set display_name=v_name where id=p_link_id and owner_id=v_owner;
 end if;
 return jsonb_build_object('success',true,'telegram_position',p_position,'display_name',v_name,'swapped_link_id',v_other.id);
end; $$;
revoke all on function public.edit_telegram_member(uuid,text,integer) from public,anon;
grant execute on function public.edit_telegram_member(uuid,text,integer) to authenticated;
