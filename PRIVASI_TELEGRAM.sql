-- Run after FIX_UNITSALDO.sql / BOT_TELEGRAM.sql.
-- Position is retained when reconnecting to the same family, including inactive links.
alter table public.telegram_links add column if not exists telegram_position integer;
with ranked as (
 select id,row_number() over(partition by owner_id order by linked_at,id)::integer as position
 from public.telegram_links
) update public.telegram_links t set telegram_position=r.position from ranked r
 where t.id=r.id and t.telegram_position is null;
alter table public.telegram_links drop constraint if exists telegram_position_positive;
alter table public.telegram_links add constraint telegram_position_positive check(telegram_position>0);

create or replace function public.link_telegram_by_code(p_link_code text,p_chat_id text,p_username text default null,p_first_name text default null)
returns json language plpgsql security definer set search_path=public,pg_temp as $$
declare v_profile public.profiles%rowtype; v_link public.telegram_links%rowtype; v_position integer;
begin
 if coalesce(trim(p_chat_id),'')='' or coalesce(trim(p_link_code),'')='' then return json_build_object('success',false,'message','Kode tidak valid'); end if;
 -- Serializes allocation and single-use code consumption within this family.
 select * into v_profile from public.profiles where telegram_link_code=upper(trim(p_link_code)) for update;
 if not found then return json_build_object('success',false,'message','Kode tidak ditemukan atau sudah digunakan'); end if;
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
