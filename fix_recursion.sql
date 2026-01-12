-- ==============================================================================
-- FIX INFINITE RECURSION (Erreur 42P17)
-- Ce script supprime la politique administrative qui cause la boucle infinie.
-- ==============================================================================

-- 1. Supprimer la politique qui cause la récursion
-- "Admins can view all profiles" vérifie "profiles" -> récursion
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;

-- 2. S'assurer que les utilisateurs normaux peuvent toujours voir LEUR PROPRE profil
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;

CREATE POLICY "Users can view own profile" 
ON public.profiles 
FOR SELECT 
USING (auth.uid() = id);

-- 3. (Optionnel) S'assurer que l'insertion fonctionne toujours
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;

CREATE POLICY "Users can insert own profile" 
ON public.profiles 
FOR INSERT 
WITH CHECK (auth.uid() = id);

-- ==============================================================================
-- INSTRUCTIONS:
-- 1. Cliquez sur "Run".
-- 2. Retournez sur l'application et rechargez la page.
-- ==============================================================================
