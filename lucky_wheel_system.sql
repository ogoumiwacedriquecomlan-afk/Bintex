-- ==============================================================================
-- BINTEX GAMES & GLOBAL ACTIVITY LOG
-- ==============================================================================

-- 1. Update Profiles Table
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS spins_count int DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_spins_done int DEFAULT 0;

-- 2. Create Global Activity Table (for the ticker and admin)
CREATE TABLE IF NOT EXISTS public.global_activity (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES public.profiles(id),
  user_name text, -- Obfuscated initially or stored as is and processed in view
  type text, -- 'dépôt', 'achat', 'retrait', 'gain_roue'
  amount numeric,
  detail text,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now())
);

-- Enable RLS for global_activity
ALTER TABLE public.global_activity ENABLE ROW LEVEL SECURITY;

-- Policy: Everyone can read the last 20 activities (for the banner)
CREATE POLICY "Public can read global activities" 
ON public.global_activity FOR SELECT 
USING (true);

-- 3. Function to log activity (Internal helper)
CREATE OR REPLACE FUNCTION public.log_activity(u_id uuid, a_type text, a_amount numeric, a_detail text)
RETURNS void AS $$
DECLARE
  u_name text;
  obf_name text;
BEGIN
  SELECT name INTO u_name FROM public.profiles WHERE id = u_id;
  
  -- Create obfuscated name like BIN...
  IF length(u_name) > 3 THEN
    obf_name := upper(substring(u_name, 1, 3)) || '***';
  ELSE
    obf_name := 'UTILISATEUR***';
  END IF;

  INSERT INTO public.global_activity (user_id, user_name, type, amount, detail)
  VALUES (u_id, obf_name, a_type, a_amount, a_detail);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. RPC: Spin Wheel
CREATE OR REPLACE FUNCTION public.spin_wheel()
RETURNS JSON AS $$
DECLARE
  user_prof record;
  rand_val int;
  win_type text := 'none';
  win_amount numeric := 0;
  win_pack_name text := '';
  win_pack_price numeric := 0;
  win_pack_return numeric := 0;
BEGIN
  -- 1. Check Spins
  SELECT * INTO user_prof FROM public.profiles WHERE id = auth.uid();
  
  IF user_prof.spins_count <= 0 THEN
    RAISE EXCEPTION 'Vous n''avez plus de tours disponibles.';
  END IF;

  -- 2. Consume Spin
  UPDATE public.profiles 
  SET spins_count = spins_count - 1,
      total_spins_done = total_spins_done + 1
  WHERE id = auth.uid();

  -- 3. Randomize (0-1000)
  rand_val := floor(random() * 1001);

  -- [WEIGHTS]
  -- 0-600: 0 FCFA (60%)
  -- 601-900: 100 FCFA (30%)
  -- 901-970: 1000 FCFA (7%)
  -- 971-990: 2000 FCFA (2%)
  -- 991-997: 5000 FCFA (0.7%)
  -- 998: Pack 2000 FCFA (0.1%)
  -- 999: Pack 5000 FCFA (0.1%)
  -- 1000: Pack 15000 FCFA (0.1%)

  IF rand_val <= 600 THEN
    win_type := 'cash';
    win_amount := 0;
  ELSIF rand_val <= 900 THEN
    win_type := 'cash';
    win_amount := 100;
  ELSIF rand_val <= 970 THEN
    win_type := 'cash';
    win_amount := 1000;
  ELSIF rand_val <= 990 THEN
    win_type := 'cash';
    win_amount := 2000;
  ELSIF rand_val <= 997 THEN
    win_type := 'cash';
    win_amount := 5000;
  ELSIF rand_val = 998 THEN
    win_type := 'pack';
    win_pack_name := 'Starter (Gagné)';
    win_pack_price := 2000;
    win_pack_return := 400;
  ELSIF rand_val = 999 THEN
    win_type := 'pack';
    win_pack_name := 'Basic (Gagné)';
    win_pack_price := 5000;
    win_pack_return := 1000;
  ELSE
    win_type := 'pack';
    win_pack_name := 'Bronze (Gagné)';
    win_pack_price := 15000;
    win_pack_return := 3000;
  END IF;

  -- 4. Process Prize
  IF win_type = 'cash' AND win_amount > 0 THEN
    UPDATE public.profiles SET balance_gains = balance_gains + win_amount WHERE id = auth.uid();
  ELSIF win_type = 'pack' THEN
    UPDATE public.profiles 
    SET active_packs = active_packs || jsonb_build_object(
      'id', 'wheel_' || floor(extract(epoch from now())),
      'name', win_pack_name,
      'price', win_pack_price,
      'dailyReturn', win_pack_return,
      'purchased_at', now()
    )
    WHERE id = auth.uid();
  END IF;

  -- 5. Log Significant wins
  IF win_amount >= 1000 OR win_type = 'pack' THEN
    PERFORM public.log_activity(auth.uid(), 'gain_roue', COALESCE(win_amount, win_pack_price), 'Magnifique gain à la roue !');
  END IF;

  RETURN jsonb_build_object(
    'status', 'success',
    'result_index', rand_val, -- Index to map on the frontend wheel
    'prize_type', win_type,
    'prize_amount', win_amount,
    'prize_pack', win_pack_name
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
