-- ==============================================================================
-- SYSTEME DE RETRAITS (WITHDRAWALS)
-- ==============================================================================

-- 1. Table des Retraits
create table if not exists public.withdrawals (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) not null,
  amount numeric not null,
  fee numeric not null,
  net_amount numeric not null,
  mobile_number text not null,
  status text default 'pending', -- 'pending', 'approved', 'rejected'
  created_at timestamp with time zone default timezone('utc'::text, now())
);

-- Sécurité RLS
alter table public.withdrawals enable row level security;

-- Les utilisateurs peuvent voir leurs propres retraits
create policy "Users can view own withdrawals" 
on public.withdrawals for select 
using (auth.uid() = user_id);

-- Les admins peuvent tout voir
create policy "Admins can view all withdrawals" 
on public.withdrawals for select 
using (
  exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
);

-- 2. Fonction RPC: Demande de Retrait
create or replace function public.request_withdrawal(amount_requested numeric, phone_number text)
returns void as $$
declare
  user_prof public.profiles%ROWTYPE;
  fee_val numeric;
  net_val numeric;
  total_withdrawable numeric;
begin
  -- Récupérer le profil
  select * into user_prof from public.profiles where id = auth.uid();

  -- 1. Vérifier si Pack Actif (Investissement requis)
  if jsonb_array_length(user_prof.active_packs) = 0 then
    raise exception 'Investissement requis pour retirer.';
  end if;

  -- 2. Vérifier Montant Minimum
  if amount_requested < 1000 then
    raise exception 'Minimum de retrait : 1000 FCFA.';
  end if;

  -- 3. Calculer solde disponible (Gains + Commissions)
  -- On considère que balance_gains et balance_commissions sont les soldes retirables
  total_withdrawable := user_prof.balance_gains + user_prof.balance_commissions;

  if total_withdrawable < amount_requested then
    raise exception 'Solde insuffisant (Gains + Commissions).';
  end if;

  -- 4. Calculs Financiers
  fee_val := amount_requested * 0.10; -- 10%
  net_val := amount_requested - fee_val;

  -- 5. DÉBITER L'UTILISATEUR (Priorité Gains puis Commissions)
  -- Logique simple: On déduit globalement. Pour garder la trace précise, on vide d'abord les gains.
  if user_prof.balance_gains >= amount_requested then
    -- Tout pris sur les gains
    update public.profiles 
    set balance_gains = balance_gains - amount_requested
    where id = auth.uid();
  else
    -- Gains vide, on prend le reste sur commissions
    update public.profiles 
    set balance_gains = 0,
        balance_commissions = balance_commissions - (amount_requested - user_prof.balance_gains)
    where id = auth.uid();
  end if;

  -- 6. Enregistrer la transaction dans l'historique User
  update public.profiles
  set transactions = transactions || jsonb_build_object(
        'type', 'retrait',
        'amount', amount_requested,
        'detail', 'Retrait vers ' || phone_number,
        'date', to_char(now(), 'DD/MM/YYYY HH24:MI'),
        'status', 'En attente'
      )
  where id = auth.uid();

  -- 7. Créer la demande de retrait
  insert into public.withdrawals (user_id, amount, fee, net_amount, mobile_number, status)
  values (auth.uid(), amount_requested, fee_val, net_val, phone_number, 'pending');

end;
$$ language plpgsql security definer;


-- 3. Fonction RPC: Valider Retrait (Admin)
create or replace function public.approve_withdrawal(withdrawal_id uuid)
returns void as $$
declare
  w_record record;
begin
  -- Vérifier Admin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'Accès refusé.';
  end if;

  select * into w_record from public.withdrawals where id = withdrawal_id;

  if w_record.status != 'pending' then
    raise exception 'Déjà traité.';
  end if;

  -- Mettre à jour le statut
  update public.withdrawals set status = 'approved' where id = withdrawal_id;

  -- Mettre à jour l'historique utilisateur (Optionnel, pour dire "Validé")
  -- Note: C'est complexe de mettre à jour un JSONB array spécifique, on laisse "En attente" ou on ajoute une notif.
  -- Pour simplifier, on ne touche pas au JSON transaction, l'utilisateur verra le statut changer dans sa liste de retraits s'il y en a une,
  -- ou on considère que l'historique est figé au moment de l'action.
end;
$$ language plpgsql security definer;
