-- Function to process automatic Kkiapay payments
create or replace function public.process_kkiapay_payment(
  p_amount numeric,
  p_transaction_id text,
  p_user_id uuid
)
returns void as $$
declare
  existing_count int;
begin
  -- 1. Check if transaction already processed
  select count(*) into existing_count from public.deposits where transaction_id = p_transaction_id;
  
  if existing_count > 0 then
    raise exception 'Transaction already processed';
  end if;

  -- 2. Insert approved deposit
  insert into public.deposits (user_id, amount, transaction_id, status)
  values (p_user_id, p_amount, p_transaction_id, 'approved');

  -- 3. Credit user balance and log transaction
  update public.profiles 
  set balance_main = balance_main + p_amount,
      transactions = transactions || jsonb_build_object(
        'type', 'dépôt',
        'amount', p_amount,
        'detail', 'Kkiapay Auto (' || p_transaction_id || ')',
        'date', to_char(now(), 'DD/MM/YYYY HH24:MI'),
        'status', 'Validé'
      )
  where id = p_user_id;

end;
$$ language plpgsql security definer;
