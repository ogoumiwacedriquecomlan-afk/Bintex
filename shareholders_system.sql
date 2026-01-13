-- ==============================================================================
-- BINTEX SHAREHOLDERS (ACTIONNAIRES) PROGRAM
-- ==============================================================================

-- 1. Update Profiles Table for Bonuses
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS claimed_bonuses jsonb DEFAULT '[]'::jsonb;

-- Column for weekly bonus timestamp if applicable
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS last_weekly_bonus_at timestamp with time zone;

-- 2. RPC: Check and Award Shareholder Bonuses
CREATE OR REPLACE FUNCTION public.check_and_award_shareholder_bonuses()
RETURNS JSONB AS $$
DECLARE
  prof record;
  l1_count int;
  total_count int;
  bonus_to_award numeric := 0;
  new_claimed_bonuses jsonb;
  msg text := 'Aucun nouveau bonus.';
  weekly_awarded boolean := false;
  now_ts timestamp with time zone := now();
BEGIN
  -- Get user profile
  SELECT * INTO prof FROM public.profiles WHERE id = auth.uid();
  
  -- CONDITION: User must have at least one active pack
  IF jsonb_array_length(prof.active_packs) = 0 THEN
    RETURN jsonb_build_object('status', 'no_pack', 'message', 'Vous devez avoir un pack actif pour être Actionnaire.');
  END IF;

  -- Count Level 1 investing referrals
  SELECT count(*) INTO l1_count 
  FROM public.profiles 
  WHERE referrer_id = auth.uid() AND COALESCE(jsonb_array_length(active_packs), 0) > 0;

  -- Count Total investing referrals (L1 + L2 + L3)
  WITH RECURSIVE referral_tree AS (
    SELECT id, 1 as lvl FROM public.profiles WHERE referrer_id = auth.uid()
    UNION ALL
    SELECT p.id, rt.lvl + 1 FROM public.profiles p 
    JOIN referral_tree rt ON p.referrer_id = rt.id WHERE rt.lvl < 3
  )
  SELECT count(*) INTO total_count 
  FROM referral_tree rt 
  JOIN public.profiles p ON p.id = rt.id 
  WHERE COALESCE(jsonb_array_length(p.active_packs), 0) > 0;

  new_claimed_bonuses := prof.claimed_bonuses;

  -- LEVEL 1 BONUSES
  IF l1_count >= 15 AND NOT (new_claimed_bonuses @> '["l1_15"]'::jsonb) THEN
    bonus_to_award := bonus_to_award + 10000;
    new_claimed_bonuses := new_claimed_bonuses || '["l1_15"]'::jsonb;
  END IF;
  
  IF l1_count >= 20 AND NOT (new_claimed_bonuses @> '["l1_20"]'::jsonb) THEN
    bonus_to_award := bonus_to_award + 15000;
    new_claimed_bonuses := new_claimed_bonuses || '["l1_20"]'::jsonb;
  END IF;
  
  IF l1_count >= 30 AND NOT (new_claimed_bonuses @> '["l1_30"]'::jsonb) THEN
    bonus_to_award := bonus_to_award + 25000;
    new_claimed_bonuses := new_claimed_bonuses || '["l1_30"]'::jsonb;
  END IF;

  -- TOTAL BONUSES
  IF total_count >= 50 AND NOT (new_claimed_bonuses @> '["tot_50"]'::jsonb) THEN
    bonus_to_award := bonus_to_award + 45000;
    new_claimed_bonuses := new_claimed_bonuses || '["tot_50"]'::jsonb;
  END IF;

  IF total_count >= 75 AND NOT (new_claimed_bonuses @> '["tot_75"]'::jsonb) THEN
    bonus_to_award := bonus_to_award + 70000;
    new_claimed_bonuses := new_claimed_bonuses || '["tot_75"]'::jsonb;
  END IF;

  IF total_count >= 85 AND NOT (new_claimed_bonuses @> '["tot_85"]'::jsonb) THEN
    bonus_to_award := bonus_to_award + 80000;
    new_claimed_bonuses := new_claimed_bonuses || '["tot_85"]'::jsonb;
  END IF;

  IF total_count >= 100 AND NOT (new_claimed_bonuses @> '["tot_100"]'::jsonb) THEN
    bonus_to_award := bonus_to_award + 95000;
    new_claimed_bonuses := new_claimed_bonuses || '["tot_100"]'::jsonb;
  END IF;

  IF total_count >= 125 AND NOT (new_claimed_bonuses @> '["tot_125"]'::jsonb) THEN
    bonus_to_award := bonus_to_award + 100000;
    new_claimed_bonuses := new_claimed_bonuses || '["tot_125"]'::jsonb;
  END IF;

  -- WEEKLY BONUS (> 125 referrals)
  IF total_count >= 125 THEN
    -- Check if 7 days passed since last weekly bonus
    IF prof.last_weekly_bonus_at IS NULL OR prof.last_weekly_bonus_at <= (now_ts - interval '7 days') THEN
        bonus_to_award := bonus_to_award + 15000;
        weekly_awarded := true;
        -- Update the timestamp below
    END IF;
  END IF;

  -- APPLY CHANGES
  IF bonus_to_award > 0 THEN
    UPDATE public.profiles 
    SET balance_commissions = balance_commissions + bonus_to_award,
        claimed_bonuses = new_claimed_bonuses,
        last_weekly_bonus_at = CASE WHEN weekly_awarded THEN now_ts ELSE last_weekly_bonus_at END,
        transactions = transactions || jsonb_build_object(
          'type', 'commission',
          'amount', bonus_to_award,
          'detail', 'Bonus Actionnaire (Palier atteint)',
          'date', to_char(now_ts, 'DD/MM/YYYY HH24:MI'),
          'status', 'Reçu'
        )
    WHERE id = auth.uid();
    
    RETURN jsonb_build_object(
      'status', 'success', 
      'amount', bonus_to_award, 
      'l1', l1_count, 
      'total', total_count,
      'weekly', weekly_awarded
    );
  END IF;

  RETURN jsonb_build_object('status', 'no_new_bonus', 'l1', l1_count, 'total', total_count);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
