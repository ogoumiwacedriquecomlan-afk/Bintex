-- ==============================================================================
-- FONCTION: RECUPERER MES FILLEULS ET LEUR INVESTISSEMENT
-- ==============================================================================

create or replace function public.get_my_referrals()
returns table (
  user_id uuid,
  name text,
  email text,
  created_at text,
  active_pack_count int,
  total_invested numeric
) as $$
begin
  return query
  select 
    p.id as user_id,
    p.name,
    p.email,
    to_char(p.created_at, 'DD/MM/YYYY') as created_at,
    jsonb_array_length(p.active_packs) as active_pack_count,
    (
      select coalesce(sum((pack->>'price')::numeric), 0)
      from jsonb_array_elements(p.active_packs) as pack
    ) as total_invested
  from public.profiles p
  where p.referrer_id = auth.uid()
  order by p.created_at desc;
end;
$$ language plpgsql security definer;
