-- ==============================================================================
-- FIX ADMIN ACCESS & RLS RECURSION
-- Ce script résout le problème de la page admin vide en corrigeant les politiques
-- de sécurité et en créant une fonction de vérification robuste.
-- ==============================================================================

-- 1. Création d'une fonction de vérification Admin sécurisée
-- On utilise SECURITY DEFINER pour contourner les politiques RLS lors du check
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Mise à jour des politiques pour la table PROFILES
-- On supprime les anciennes politiques pour repartir sur une base propre
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;

-- Politique : Chacun voit son propre profil
CREATE POLICY "Users can view own profile" 
ON public.profiles FOR SELECT 
USING (auth.uid() = id);

-- Politique : L'Admin voit tout (Utilise is_admin() pour éviter la récursion)
CREATE POLICY "Admins can view all profiles" 
ON public.profiles FOR SELECT 
USING (public.is_admin());

-- Politique : Chacun peut insérer son propre profil (Nécessaire pour le trigger on_auth_user_created)
CREATE POLICY "Users can insert own profile" 
ON public.profiles FOR INSERT 
WITH CHECK (auth.uid() = id);

-- Politique : Chacun peut mettre à jour son propre profil
CREATE POLICY "Users can update own profile" 
ON public.profiles FOR UPDATE 
USING (auth.uid() = id);


-- 3. Mise à jour des politiques pour la table DEPOSITS
DROP POLICY IF EXISTS "Users can create deposits" ON public.deposits;
DROP POLICY IF EXISTS "Users can view own deposits" ON public.deposits;
DROP POLICY IF EXISTS "Admins can manage deposits" ON public.deposits;

CREATE POLICY "Users can create deposits" ON public.deposits FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can view own deposits" ON public.deposits FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins can manage deposits" ON public.deposits FOR ALL USING (public.is_admin());


-- 4. Mise à jour des politiques pour la table WITHDRAWALS
-- S'assurer que la table existe (au cas où setup_withdrawals.sql n'a pas été exécuté complètement)
DO $$ 
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'withdrawals') THEN
        DROP POLICY IF EXISTS "Users can view own withdrawals" ON public.withdrawals;
        DROP POLICY IF EXISTS "Admins can view all withdrawals" ON public.withdrawals;

        CREATE POLICY "Users can view own withdrawals" ON public.withdrawals FOR SELECT USING (auth.uid() = user_id);
        CREATE POLICY "Admins can view all withdrawals" ON public.withdrawals FOR SELECT USING (public.is_admin());
    END IF;
END $$;


-- 5. VERIFICATION ADMIN (Remplacer l'email si nécessaire)
-- Exécutez cette partie manuellement ou décommentez la ligne ci-dessous en remplaçant l'email.
-- UPDATE public.profiles SET role = 'admin' WHERE email = 'VOTRE_EMAIL_ICI';

-- ==============================================================================
-- INSTRUCTIONS :
-- 1. Copiez tout ce code et collez-le dans l'éditeur SQL de Supabase.
-- 2. Cliquez sur "Run".
-- 3. Rechargez la page admin.html
-- ==============================================================================
