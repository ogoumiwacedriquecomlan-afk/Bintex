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
CREATE OR REPLACE FUNCTION public.request_withdrawal(amount_requested numeric, phone_number text, payment_method text)
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

  -- CONDITION 1: Au moins un dépôt approuvé (Sauf si skip_deposit_check est vrai)
  IF NOT user_prof.skip_deposit_check THEN
    SELECT EXISTS (
      SELECT 1 FROM public.deposits WHERE user_id = auth.uid() AND status = 'approved'
    ) INTO has_deposit;
    
    IF NOT has_deposit THEN
      RAISE EXCEPTION 'Un dépôt minimum est requis pour effectuer un retrait.';
    END IF;
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
        'detail', 'Retrait (' || payment_method || ') vers ' || phone_number,
        'date', to_char(now(), 'DD/MM/YYYY HH24:MI'),
        'status', 'En attente',
        'id', 'withdraw_' || floor(extract(epoch from now())) -- Added ID for tracking
      )
  WHERE id = auth.uid();

  -- 7. Créer la demande
  INSERT INTO public.withdrawals (user_id, amount, fee, net_amount, mobile_number, payment_method, status)
  VALUES (auth.uid(), amount_requested, fee_val, net_val, phone_number, payment_method, 'pending');

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

  -- [NEW] Log Activity
  PERFORM public.log_activity(w_record.user_id, 'retrait', w_record.amount, 'Retrait réussi');

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. RPC: Process Daily Rewards (Calendar Day based + 30-day Expiry)
CREATE OR REPLACE FUNCTION public.process_daily_rewards()
RETURNS JSON AS $$
DECLARE
  prof record;
  pack jsonb;
  new_active_packs jsonb := '[]'::jsonb;
  total_daily_return numeric := 0;
  total_gain_to_award numeric := 0;
  days_missed int := 0;
  now_ts timestamp with time zone := now();
  last_reward_date date;
  current_system_date date := current_date;
BEGIN
  -- 1. Get profile
  SELECT * INTO prof FROM public.profiles WHERE id = auth.uid();
  last_reward_date := prof.last_reward_at::date;
  
  -- 2. Calculate days missed (Calendar days transition)
  days_missed := (current_system_date - last_reward_date);

  -- 3. Filter Active Packs (30-day expiry)
  FOR pack IN SELECT * FROM jsonb_array_elements(prof.active_packs) LOOP
    -- Check if pack is still valid (less than 30 days old)
    IF (now_ts - COALESCE((pack->>'purchased_at')::timestamp with time zone, to_date(pack->>'date', 'DD/MM/YYYY')::timestamp with time zone)) < interval '30 days' THEN
      new_active_packs := new_active_packs || pack;
      -- Safely add return value, check for dailyReturn or daily (legacy)
      total_daily_return := total_daily_return + COALESCE((pack->>'dailyReturn')::numeric, (pack->>'daily')::numeric, 0);
    END IF;
  END LOOP;

  -- 4. If days passed, award gains
  IF days_missed >= 1 THEN
    total_gain_to_award := total_daily_return * days_missed;
    
    UPDATE public.profiles
    SET balance_gains = balance_gains + total_gain_to_award,
        active_packs = new_active_packs, -- Update packs (removes expired ones)
        last_reward_at = now_ts, -- Reset to now (or rather current_system_date 00:00 for strictness, but now is safer for partial days)
        transactions = CASE 
          WHEN total_gain_to_award > 0 THEN 
            transactions || jsonb_build_object(
              'type', 'gain',
              'amount', total_gain_to_award,
              'detail', 'Gains journaliers distributeur (' || days_missed || ' jour(s))',
              'date', to_char(now_ts, 'DD/MM/YYYY HH24:MI'),
              'status', 'Validé'
            )
          ELSE transactions 
        END
    WHERE id = auth.uid();

    RETURN jsonb_build_object(
      'status', 'success', 
      'amount', total_gain_to_award, 
      'days_processed', days_missed,
      'packs_removed', jsonb_array_length(prof.active_packs) - jsonb_array_length(new_active_packs)
    );
  ELSE
    -- Just update packs if any expired without awarding gains
    IF jsonb_array_length(prof.active_packs) != jsonb_array_length(new_active_packs) THEN
       UPDATE public.profiles SET active_packs = new_active_packs WHERE id = auth.uid();
    END IF;
    
    RETURN jsonb_build_object('status', 'waiting');
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
