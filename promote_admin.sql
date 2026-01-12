-- Remplacer 'votre@email.com' par votre adresse email de connexion
UPDATE public.profiles
SET role = 'admin'
WHERE email = 'votre@email.com';
