-- ==============================================================================
-- BINTEX DATABASE SETUP (Version Corrigée - RESET)
-- ATTENTION : Ceci va supprimer les tables existantes pour recréer la structure propre.
-- ==============================================================================

-- 1. NETTOYAGE (On supprime pour éviter l'erreur "Already Exists")
DROP TRIGGER IF EXISTS on_auth_user_created on auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user;
DROP FUNCTION IF EXISTS public.approve_deposit;
DROP FUNCTION IF EXISTS public.buy_pack;
DROP TABLE IF EXISTS public.deposits;
DROP TABLE IF EXISTS public.profiles CASCADE;


-- 2. TABLE DES PROFILS
create table public.profiles (
  id uuid references auth.users not null primary key,
  email text,
  name text,
  phone text,
  referral_code text unique,
  referrer_id uuid references public.profiles(id),
  balance_main numeric default 0,
  balance_gains numeric default 0,
  balance_commissions numeric default 0,
  active_packs jsonb default '[]'::jsonb,
  transactions jsonb default '[]'::jsonb,
  role text default 'user',  -- 'user' ou 'admin'
  created_at timestamp with time zone default timezone('utc'::text, now())
);

-- Sécurité (RLS) pour Profiles
alter table public.profiles enable row level security;
create policy "Users can view own profile" on public.profiles for select using (auth.uid() = id);
create policy "Admins can view all profiles" on public.profiles for select using (
  exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
);

-- 3. TABLE DES DÉPÔTS
create table public.deposits (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) not null,
  amount numeric not null,
  transaction_id text not null,
  sender_phone text,
  status text default 'pending', -- 'pending', 'approved', 'rejected'
  created_at timestamp with time zone default timezone('utc'::text, now())
);

-- Sécurité (RLS) pour Deposits
alter table public.deposits enable row level security;
create policy "Users can create deposits" on public.deposits for insert with check (auth.uid() = user_id);
create policy "Users can view own deposits" on public.deposits for select using (auth.uid() = user_id);
create policy "Admins can manage deposits" on public.deposits for all using (
  exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
);

-- 4. FONCTION AUTO: CRÉATION PROFIL + PARRAINAGE (Trigger)
create or replace function public.handle_new_user()
returns trigger as $$
declare
  ref_code text;
  referrer_id uuid;
  given_ref_code text;
begin
  -- 1. Générer code de parrainage unique (BIN + 5 caractères aléatoires)
  loop
    ref_code := 'BIN' || upper(substring(md5(random()::text), 1, 5));
    if not exists (select 1 from public.profiles where referral_code = ref_code) then
      exit;
    end if;
  end loop;

  -- 2. Trouver le parrain (si fourni dans metadata)
  given_ref_code := new.raw_user_meta_data->>'referrer_code';
  if given_ref_code is not null then
    select id into referrer_id from public.profiles where referral_code = given_ref_code;
  end if;

  -- 3. Insérer le profil
  insert into public.profiles (id, email, name, phone, referral_code, referrer_id)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'phone',
    ref_code,
    referrer_id
  );
  return new;
end;
$$ language plpgsql security definer;

-- Trigger à chaque inscription
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();


-- 5. FONCTION ADMIN: VALIDER DÉPÔT
create or replace function public.approve_deposit(deposit_id uuid)
returns void as $$
declare
  d_record record;
begin
  -- Vérifier si Admin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'Accès refusé. Admin uniquement.';
  end if;

  -- Récupérer le dépôt
  select * into d_record from public.deposits where id = deposit_id;
  
  if d_record.status != 'pending' then
    raise exception 'Ce dépôt n''est pas en attente.';
  end if;

  -- 1. Mettre à jour le statut
  update public.deposits set status = 'approved' where id = deposit_id;

  -- 2. Créditer le compte Principal
  update public.profiles 
  set balance_main = balance_main + d_record.amount,
      transactions = transactions || jsonb_build_object(
        'type', 'dépôt',
        'amount', d_record.amount,
        'detail', 'Via Kkiapay/Direct',
        'date', to_char(now(), 'DD/MM/YYYY HH24:MI'),
        'status', 'Validé'
      )
  where id = d_record.user_id;

end;
$$ language plpgsql security definer;


-- 6. FONCTION ACHAT PACK + AFFILIATION
create or replace function public.buy_pack(pack_name text, pack_price numeric, pack_daily numeric)
returns void as $$
declare
  user_prof public.profiles%ROWTYPE;
  upline1 uuid;
  upline2 uuid;
  upline3 uuid;
  comm1 numeric;
  comm2 numeric;
  comm3 numeric;
begin
  -- Récupérer profil utilisateur
  select * into user_prof from public.profiles where id = auth.uid();

  -- Vérifier solde
  if user_prof.balance_main < pack_price then
    raise exception 'Solde insuffisant.';
  end if;

  -- 1. DÉBITER L'UTILISATEUR & AJOUTER PACK
  update public.profiles
  set balance_main = balance_main - pack_price,
      active_packs = active_packs || jsonb_build_object(
        'id', 'pk_' || floor(extract(epoch from now())), 
        'name', pack_name,
        'price', pack_price,
        'dailyReturn', pack_daily,
        'date', to_char(now(), 'DD/MM/YYYY'),
        'purchased_at', now() -- [NEW] Precise timestamp
      ),
      transactions = transactions || jsonb_build_object(
        'type', 'achat',
        'amount', pack_price,
        'detail', 'Pack ' || pack_name,
        'date', to_char(now(), 'DD/MM/YYYY HH24:MI'),
        'status', 'Activé'
      )
  where id = auth.uid();

  -- 2. DISTRIBUTION COMMISSION (3 NIVEAUX)
  
  -- Niveau 1 (30%)
  upline1 := user_prof.referrer_id;
  if upline1 is not null then
    comm1 := pack_price * 0.30;
    update public.profiles 
    set balance_commissions = balance_commissions + comm1,
        transactions = transactions || jsonb_build_object(
          'type', 'commission',
          'amount', comm1,
          'detail', 'Niveau 1 (De: ' || user_prof.name || ')',
          'date', to_char(now(), 'DD/MM/YYYY HH24:MI'),
          'status', 'Reçu'
        )
    where id = upline1;

    -- Niveau 2 (10%)
    select referrer_id into upline2 from public.profiles where id = upline1;
    if upline2 is not null then
      comm2 := pack_price * 0.10;
      update public.profiles 
      set balance_commissions = balance_commissions + comm2,
          transactions = transactions || jsonb_build_object(
            'type', 'commission',
            'amount', comm2,
            'detail', 'Niveau 2',
            'date', to_char(now(), 'DD/MM/YYYY HH24:MI'),
            'status', 'Reçu'
          )
      where id = upline2;

      -- Niveau 3 (5%)
      select referrer_id into upline3 from public.profiles where id = upline2;
      if upline3 is not null then
        comm3 := pack_price * 0.05;
        update public.profiles 
        set balance_commissions = balance_commissions + comm3,
            transactions = transactions || jsonb_build_object(
              'type', 'commission',
              'amount', comm3,
              'detail', 'Niveau 3',
              'date', to_char(now(), 'DD/MM/YYYY HH24:MI'),
              'status', 'Reçu'
            )
        where id = upline3;
      end if;
    end if;
  end if;

end;
$$ language plpgsql security definer;
