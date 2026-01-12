-- 1. Ajouter le champ sender_phone à la table deposits si absent
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='deposits' AND column_name='sender_phone') THEN
        ALTER TABLE public.deposits ADD COLUMN sender_phone TEXT;
    END IF;
END $$;

-- 2. Fonction Admin: REJETER DÉPÔT
CREATE OR REPLACE FUNCTION public.reject_deposit(deposit_id UUID)
RETURNS VOID AS $$
BEGIN
  -- Vérifier si Admin
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'Accès refusé. Admin uniquement.';
  END IF;

  UPDATE public.deposits SET status = 'rejected' WHERE id = deposit_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
