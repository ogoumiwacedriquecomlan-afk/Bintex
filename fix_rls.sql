-- ==============================================================================
-- FIX (CORRECTIF) POUR LE PROBLÈME DECONNEXION / PROFIL MANQUANT
-- ==============================================================================
-- Ce script autorise "l'auto-réparation" des profils.

-- 1. Autoriser l'utilisateur à CRÉER son propre profil (si manquant)
create policy "Users can insert own profile" 
on public.profiles 
for insert 
with check (auth.uid() = id);

-- 2. Autoriser l'utilisateur à METTRE A JOUR son profil (info basique)
create policy "Users can update own profile" 
on public.profiles 
for update 
using (auth.uid() = id);

-- CLIQUEZ SUR "RUN" POUR APPLIQUER
