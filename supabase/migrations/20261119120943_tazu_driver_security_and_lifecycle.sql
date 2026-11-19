-- TAZU driver onboarding, approval protection, and ride lifecycle enforcement.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare requested_role text;
begin
  requested_role := case when new.raw_user_meta_data ->> 'requested_role' = 'driver' then 'driver' else 'passenger' end;
  insert into public.profiles (id, full_name, role)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''), requested_role)
  on conflict (id) do nothing;
  if requested_role = 'driver' then
    insert into public.drivers (user_id, is_online, is_approved)
    values (new.id, false, false)
    on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;

create or replace function public.tazu_protect_profile_role()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if auth.uid() is not null and new.role is distinct from old.role then
    raise exception 'Account role changes require administrator approval' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists tazu_protect_profile_role on public.profiles;
create trigger tazu_protect_profile_role before update on public.profiles
for each row execute function public.tazu_protect_profile_role();

create or replace function public.tazu_protect_driver_approval()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if auth.uid() is not null and (
    new.user_id is distinct from old.user_id or
    new.is_approved is distinct from old.is_approved
  ) then
    raise exception 'Driver identity and approval require administrator action' using errcode = '42501';
  end if;
  if auth.uid() is not null and old.is_approved = false and new.is_online = true then
    raise exception 'Driver account must be approved before going online' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists tazu_protect_driver_approval on public.drivers;
create trigger tazu_protect_driver_approval before update on public.drivers
for each row execute function public.tazu_protect_driver_approval();

create or replace function public.tazu_enforce_ride_lifecycle()
returns trigger language plpgsql set search_path = ''
as $$
declare actor uuid;
begin
  actor := auth.uid();
  if actor is null then return new; end if;

  if old.status = 'requested' and new.status = 'accepted' then
    if new.driver_id is distinct from actor
       or not exists (select 1 from public.drivers d where d.user_id = actor and d.is_approved = true and d.is_online = true)
       or (to_jsonb(new) - array['driver_id','status','updated_at']) is distinct from
          (to_jsonb(old) - array['driver_id','status','updated_at']) then
      raise exception 'Only an approved online driver may accept a ride' using errcode = '42501';
    end if;
    return new;
  end if;

  if old.status = 'accepted' and new.status in ('in_progress','cancelled') then
    if old.driver_id is distinct from actor or new.driver_id is distinct from old.driver_id
       or (to_jsonb(new) - array['status','updated_at']) is distinct from
          (to_jsonb(old) - array['status','updated_at']) then
      raise exception 'Only the assigned driver may start or cancel this ride' using errcode = '42501';
    end if;
    return new;
  end if;

  if old.status = 'in_progress' and new.status = 'completed' then
    if old.driver_id is distinct from actor or new.driver_id is distinct from old.driver_id
       or (to_jsonb(new) - array['status','updated_at']) is distinct from
          (to_jsonb(old) - array['status','updated_at']) then
      raise exception 'Only the assigned driver may complete this ride' using errcode = '42501';
    end if;
    return new;
  end if;

  raise exception 'Invalid ride update or ride lifecycle transition' using errcode = '42501';
end;
$$;
drop trigger if exists tazu_enforce_ride_lifecycle on public.rides;
create trigger tazu_enforce_ride_lifecycle before update on public.rides
for each row execute function public.tazu_enforce_ride_lifecycle();

drop policy if exists "TAZU allow accepting requested rides" on public.rides;
create policy "TAZU allow accepting requested rides" on public.rides for update to authenticated
using (
  status = 'requested' and driver_id is null and exists (
    select 1 from public.drivers d where d.user_id = (select auth.uid()) and d.is_approved = true and d.is_online = true
  )
)
with check (
  driver_id = (select auth.uid()) and status = 'accepted' and exists (
    select 1 from public.drivers d where d.user_id = (select auth.uid()) and d.is_approved = true and d.is_online = true
  )
);

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

create index if not exists rides_passenger_id_idx on public.rides(passenger_id);
create index if not exists rides_driver_id_idx on public.rides(driver_id);
create index if not exists drivers_dispatch_idx on public.drivers(is_approved,is_online)
where is_approved = true and is_online = true;
