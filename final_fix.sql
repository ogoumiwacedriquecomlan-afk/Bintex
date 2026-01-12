-- ==============================================================================
-- CORRECTION FINALE DES PERMISSIONS (RLS)
-- Exécutez ce script pour débloquer la connexion.
-- ==============================================================================

-- 1. On supprime les anciennes règles (au cas où elles seraient mal configurées)
drop policy if exists "Users can insert own profile" on public.profiles;
drop policy if exists "Users can update own profile" on public.profiles;

-- 2. On recrée la règle qui autorise l'AUTO-RÉPARATION (INSERT)
create policy "Users can insert own profile" 
on public.profiles 
for insert 
with check (auth.uid() = id);

-- 3. On recrée la règle pour la mise à jour (UPDATE)
create policy "Users can update own profile" 
on public.profiles 
for update 
using (auth.uid() = id);

-- 4. On s'assure que la lecture est OK
drop policy if exists "Users can view own profile" on public.profiles;
create policy "Users can view own profile" 
on public.profiles 
for select 
using (auth.uid() = id);

-- ==============================================================================
-- Après avoir cliqué sur RUN, retournez sur le site et actualisez.
-- ==============================================================================
