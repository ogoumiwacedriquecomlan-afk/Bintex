-- ==============================================================================
-- BINTEX REWARDS, WITHDRAWALS & TIERED REFERRALS UPDATE
-- ==============================================================================

-- 1. Update Profiles Table
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS last_reward_at timestamp with time zone DEFAULT timezone('utc'::text, now());

-- 2. RPC: Get Leveled Referrals (Level 1, 2, 3)
CREATE OR REPLACE FUNCTION public.get_team_referrals()
RETURNS TABLE (
  user_id uuid,
  name text,
  level int,
  active_pack_count int,
  total_invested numeric,
  created_at text
) AS $$
BEGIN
  RETURN QUERY
  WITH RECURSIVE referral_tree AS (
    -- Level 1
    SELECT p.id, p.name, 1 as lvl, p.referrer_id, p.active_packs, p.created_at
    FROM public.profiles p
    WHERE p.referrer_id = auth.uid()
    
    UNION ALL
    
    -- Level 2 & 3
    SELECT p.id, p.name, rt.lvl + 1, p.referrer_id, p.active_packs, p.created_at
    FROM public.profiles p
    JOIN referral_tree rt ON p.referrer_id = rt.id
    WHERE rt.lvl < 3
  )
  SELECT 
    rt.id as user_id,
    rt.name,
    rt.lvl as level,
    jsonb_array_length(rt.active_packs) as active_pack_count,
    (
      SELECT coalesce(sum((pack->>'price')::numeric), 0)
      FROM jsonb_array_elements(rt.active_packs) as pack
    ) as total_invested,
    to_char(rt.created_at, 'DD/MM/YYYY') as created_at
  FROM referral_tree rt
  ORDER BY rt.lvl ASC, rt.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Update Withdrawal RPC with Conditions
CREATE OR REPLACE FUNCTION public.request_withdrawal(amount_requested numeric, phone_number text)
RETURNS void AS $$
DECLARE
  user_prof public.profiles%ROWTYPE;
  fee_val numeric;
  net_val numeric;
  total_withdrawable numeric;
  has_deposit boolean;
BEGIN
  -- Récupérer le profil
  SELECT * INTO user_prof FROM public.profiles WHERE id = auth.uid();

  -- CONDITION 1: Au moins un dépôt approuvé
  SELECT EXISTS (
    SELECT 1 FROM public.deposits WHERE user_id = auth.uid() AND status = 'approved'
  ) INTO has_deposit;
  
  IF NOT has_deposit THEN
    RAISE EXCEPTION 'Un dépôt minimum est requis pour effectuer un retrait.';
  END IF;

  -- CONDITION 2: Au moins un pack payé
  IF jsonb_array_length(user_prof.active_packs) = 0 THEN
    RAISE EXCEPTION 'L''achat d''au moins un pack est requis pour retirer.';
  END IF;

  -- 2. Vérifier Montant Minimum
  IF amount_requested < 2000 THEN
    RAISE EXCEPTION 'Minimum de retrait : 2000 FCFA.';
  END IF;

  -- 3. Calculer solde disponible
  total_withdrawable := user_prof.balance_gains + user_prof.balance_commissions;

  IF total_withdrawable < amount_requested THEN
    RAISE EXCEPTION 'Solde insuffisant (Gains + Commissions).';
  END IF;

  -- 4. Calculs Financiers
  fee_val := amount_requested * 0.10; -- 10%
  net_val := amount_requested - fee_val;

  -- 5. DÉBITER L'UTILISATEUR
  IF user_prof.balance_gains >= amount_requested THEN
    UPDATE public.profiles SET balance_gains = balance_gains - amount_requested WHERE id = auth.uid();
  ELSE
    UPDATE public.profiles 
    SET balance_gains = 0,
        balance_commissions = balance_commissions - (amount_requested - user_prof.balance_gains)
    WHERE id = auth.uid();
  END IF;

  -- 6. Enregistrer la transaction
  UPDATE public.profiles
  SET transactions = transactions || jsonb_build_object(
        'type', 'retrait',
        'amount', amount_requested,
        'detail', 'Retrait vers ' || phone_number,
        'date', to_char(now(), 'DD/MM/YYYY HH24:MI'),
        'status', 'En attente',
        'id', 'withdraw_' || floor(extract(epoch from now())) -- Added ID for tracking
      )
  WHERE id = auth.uid();

  -- 7. Créer la demande
  INSERT INTO public.withdrawals (user_id, amount, fee, net_amount, mobile_number, status)
  VALUES (auth.uid(), amount_requested, fee_val, net_val, phone_number, 'pending');

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. RPC: Approve Withdrawal (Update History automatically)
CREATE OR REPLACE FUNCTION public.approve_withdrawal(withdrawal_id uuid)
RETURNS void AS $$
DECLARE
  w_record record;
BEGIN
  -- Vérifier Admin
  IF NOT EXISTS (select 1 from public.profiles where id = auth.uid() and role = 'admin') THEN
    RAISE EXCEPTION 'Accès refusé.';
  END IF;

  SELECT * INTO w_record FROM public.withdrawals WHERE id = withdrawal_id;

  IF w_record.status != 'pending' THEN
    RAISE EXCEPTION 'Déjà traité.';
  END IF;

  -- Mettre à jour le statut du retrait
  UPDATE public.withdrawals SET status = 'approved' WHERE id = withdrawal_id;

  -- AUTOMATISATION : Mettre à jour le JSONB transactions de l'utilisateur
  -- On cherche la dernière transaction de type 'retrait' qui est 'En attente' pour ce montant
  -- Note: C'est une approche best-effort car le JSONB n'est pas idéal pour les updates ciblés.
  -- On met à jour toutes les transactions de retrait "En attente" pour cet utilisateur qui correspondent au montant du retrait.
  UPDATE public.profiles
  SET transactions = (
    SELECT jsonb_agg(
      CASE 
        WHEN (elem->>'type' = 'retrait' AND elem->>'status' = 'En attente' AND (elem->>'amount')::numeric = w_record.amount)
        THEN elem || '{"status": "Validé"}'::jsonb
        ELSE elem
      END
    )
    FROM jsonb_array_elements(transactions) AS elem
  )
  WHERE id = w_record.user_id;

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. RPC: Process Daily Rewards (Autonome)
CREATE OR REPLACE FUNCTION public.process_daily_rewards()
RETURNS JSON AS $$
DECLARE
  prof record;
  pack record;
  total_gain numeric := 0;
  total_users_processed int := 0;
  now_ts timestamp with time zone := now();
BEGIN
  -- On ne peut process que son propre reward via le dashboard (Sécurité/Limitation client-side)
  SELECT * INTO prof FROM public.profiles WHERE id = auth.uid();
  
  -- Si moins de 24h depuis le dernier reward, on sort
  IF prof.last_reward_at > (now_ts - interval '24 hours') THEN
    RETURN jsonb_build_object('status', 'waiting', 'next_reward_in', extract(epoch from (prof.last_reward_at + interval '24 hours' - now_ts)));
  END IF;

  -- Calculer les gains journaliers basés sur les packs actifs
  FOR pack IN SELECT * FROM jsonb_array_elements(prof.active_packs) LOOP
    total_gain := total_gain + (pack->>'dailyReturn')::numeric;
  END LOOP;

  IF total_gain > 0 THEN
    -- Créditer Gains
    UPDATE public.profiles
    SET balance_gains = balance_gains + total_gain,
        last_reward_at = now_ts,
        transactions = transactions || jsonb_build_object(
          'type', 'gain',
          'amount', total_gain,
          'detail', 'Revenus journaliers (Packs Actifs)',
          'date', to_char(now_ts, 'DD/MM/YYYY HH24:MI'),
          'status', 'Validé'
        )
    WHERE id = auth.uid();
    
    RETURN jsonb_build_object('status', 'success', 'amount', total_gain);
  ELSE
    -- Pas de pack = On reset quand même le timer pour éviter les calls inutiles ? 
    -- Non, on laisse le timer tel quel, mais l'utilisateur ne recevra rien.
    -- On met à jour last_reward_at pour dire "On a vérifié aujourd'hui"
    UPDATE public.profiles SET last_reward_at = now_ts WHERE id = auth.uid();
    RETURN jsonb_build_object('status', 'no_packs');
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
