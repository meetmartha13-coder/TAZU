-- Enable Supabase Realtime delivery for ride rows.
-- The frontend still has a polling fallback if Realtime is unavailable.
do $$
begin
  if to_regclass('public.rides') is not null
     and exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'rides'
     )
  then
    execute 'alter publication supabase_realtime add table public.rides';
  end if;
end
$$;
