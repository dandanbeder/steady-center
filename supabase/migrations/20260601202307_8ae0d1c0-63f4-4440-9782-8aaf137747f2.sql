
-- Migration 2 (retry): membership-based RLS

-- 0. Lock down helper functions
revoke all on function public.is_platform_admin() from public, anon;
revoke all on function public.is_member(uuid, text) from public, anon;
revoke all on function public.current_membership_role(uuid) from public, anon;
grant execute on function public.is_platform_admin() to authenticated, service_role;
grant execute on function public.is_member(uuid, text) to authenticated, service_role;
grant execute on function public.current_membership_role(uuid) to authenticated, service_role;

-- Helper: business_id for a list (via folder)
create or replace function public.business_for_list(p_list_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select f.business_id
  from public.lists l
  join public.folders f on f.id = l.folder_id
  where l.id = p_list_id
$$;
revoke all on function public.business_for_list(uuid) from public, anon;
grant execute on function public.business_for_list(uuid) to authenticated, service_role;

-- Drop ALL existing policies on every table we touch
do $$
declare
  t text;
  pol record;
  all_tables text[] := array[
    'businesses','calendars','events','folders','lists','tasks','notes',
    'meetings','action_items','weekly_reports','memberships'
  ];
begin
  foreach t in array all_tables loop
    for pol in
      select policyname from pg_policies
      where schemaname='public' and tablename=t
    loop
      execute format('drop policy if exists %I on public.%I', pol.policyname, t);
    end loop;
  end loop;
end $$;

-- 1. businesses
create policy "biz_select_member" on public.businesses for select to authenticated
  using (public.is_member(id,'viewer') or public.is_platform_admin());
create policy "biz_insert_self_owner" on public.businesses for insert to authenticated
  with check (owner_id = auth.uid() and (created_by is null or created_by = auth.uid()));
create policy "biz_update_member" on public.businesses for update to authenticated
  using (public.is_member(id,'member') or public.is_platform_admin())
  with check (public.is_member(id,'member') or public.is_platform_admin());
create policy "biz_delete_owner" on public.businesses for delete to authenticated
  using (public.is_member(id,'owner') or public.is_platform_admin());

-- 2. Business-scoped tables that HAVE a business_id column
do $$
declare
  t text;
  scoped text[] := array[
    'calendars','events','folders','tasks','notes',
    'meetings','action_items','weekly_reports'
  ];
begin
  foreach t in array scoped loop
    execute format($f$
      create policy "%1$s_select_member" on public.%1$I for select to authenticated
        using (public.is_member(business_id,'viewer') or public.is_platform_admin())
    $f$, t);
    execute format($f$
      create policy "%1$s_insert_member" on public.%1$I for insert to authenticated
        with check (public.is_member(business_id,'member') or public.is_platform_admin())
    $f$, t);
    execute format($f$
      create policy "%1$s_update_member" on public.%1$I for update to authenticated
        using (public.is_member(business_id,'member') or public.is_platform_admin())
        with check (public.is_member(business_id,'member') or public.is_platform_admin())
    $f$, t);
    execute format($f$
      create policy "%1$s_delete_admin" on public.%1$I for delete to authenticated
        using (public.is_member(business_id,'admin') or public.is_platform_admin())
    $f$, t);
  end loop;
end $$;

-- 3. lists (scoped via folder)
create policy "lists_select_member" on public.lists for select to authenticated
  using (
    public.is_platform_admin()
    or public.is_member(
         (select business_id from public.folders where id = lists.folder_id),
         'viewer'
       )
  );
create policy "lists_insert_member" on public.lists for insert to authenticated
  with check (
    public.is_platform_admin()
    or public.is_member(
         (select business_id from public.folders where id = lists.folder_id),
         'member'
       )
  );
create policy "lists_update_member" on public.lists for update to authenticated
  using (
    public.is_platform_admin()
    or public.is_member(
         (select business_id from public.folders where id = lists.folder_id),
         'member'
       )
  )
  with check (
    public.is_platform_admin()
    or public.is_member(
         (select business_id from public.folders where id = lists.folder_id),
         'member'
       )
  );
create policy "lists_delete_admin" on public.lists for delete to authenticated
  using (
    public.is_platform_admin()
    or public.is_member(
         (select business_id from public.folders where id = lists.folder_id),
         'admin'
       )
  );

-- 4. memberships policies
create policy "memberships_select" on public.memberships for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_member(business_id,'admin')
    or public.is_platform_admin()
  );
create policy "memberships_insert_admin" on public.memberships for insert to authenticated
  with check (
    (public.is_member(business_id,'admin') or public.is_platform_admin())
    and (role <> 'owner' or public.is_member(business_id,'owner') or public.is_platform_admin())
  );
create policy "memberships_update_admin" on public.memberships for update to authenticated
  using (public.is_member(business_id,'admin') or public.is_platform_admin())
  with check (
    (public.is_member(business_id,'admin') or public.is_platform_admin())
    and (role <> 'owner' or public.is_member(business_id,'owner') or public.is_platform_admin())
  );
create policy "memberships_delete_admin" on public.memberships for delete to authenticated
  using (public.is_member(business_id,'admin') or public.is_platform_admin());

-- 5. Trigger: seed owner membership on new business
create or replace function public.businesses_seed_owner_membership()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.memberships (business_id, user_id, role, status, invited_by)
  values (new.id, new.owner_id, 'owner', 'active', new.owner_id)
  on conflict do nothing;
  return new;
end $$;

drop trigger if exists trg_businesses_seed_owner_membership on public.businesses;
create trigger trg_businesses_seed_owner_membership
after insert on public.businesses
for each row execute function public.businesses_seed_owner_membership();

-- 6. Self-check
do $$
declare rls_off int;
begin
  select count(*) into rls_off from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname='public'
    and c.relname = any (array[
      'businesses','calendars','events','folders','lists','tasks','notes',
      'meetings','action_items','weekly_reports','memberships','reminders','profiles'
    ])
    and c.relrowsecurity = false;
  if rls_off > 0 then
    raise exception 'Post-rewrite RLS check failed: % table(s) have RLS disabled', rls_off;
  end if;

  if exists (
    select 1 from public.businesses b
    where not exists (
      select 1 from public.memberships m
      where m.business_id = b.id
        and m.user_id = 'ae5bb1bd-6494-4bcd-ab59-f6ddd9696b37'
        and m.role = 'owner' and m.status = 'active'
    )
  ) then
    raise exception 'Seed user is not owner of every existing business';
  end if;
end $$;
