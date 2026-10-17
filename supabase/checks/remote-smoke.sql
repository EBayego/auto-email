-- Verificación no persistente en el único proyecto remoto de auto-email.
-- No crea tablas, no instala extensiones y no conserva usuarios de prueba.
begin;
do $verify$
declare
  owner_a uuid := gen_random_uuid();
  owner_b uuid := gen_random_uuid();
  account_a uuid;
  run_a uuid;
begin
  insert into auth.users (id, aud, role, email)
  values
    (owner_a, 'authenticated', 'authenticated', 'mail006-check-' || owner_a || '@example.invalid'),
    (owner_b, 'authenticated', 'authenticated', 'mail006-check-' || owner_b || '@example.invalid');
  insert into public.users (id) values (owner_a), (owner_b);
  insert into public.user_settings (user_id) values (owner_a), (owner_b);
  insert into public.gmail_accounts (user_id, email)
  values (owner_a, 'mail006-check-' || owner_a || '@example.invalid') returning id into account_a;
  insert into public.processing_runs (user_id, gmail_account_id)
  values (owner_a, account_a) returning id into run_a;

  if not exists (select 1 from public.processing_runs where id = run_a and user_id = owner_a) then
    raise exception 'No se pudo recuperar la ejecución insertada';
  end if;
  if exists (select 1 from public.user_settings where user_id = owner_a and automation_enabled) then
    raise exception 'La automatización debe comenzar desactivada';
  end if;

  begin
    insert into public.processing_runs (user_id, gmail_account_id) values (owner_b, account_a);
    raise exception 'La clave foránea no impide atribuir una cuenta a otro propietario';
  exception when foreign_key_violation then
    null;
  end;

  begin
    update public.gmail_accounts set status = 'CONNECTED' where id = account_a;
    raise exception 'Se ha admitido una conexión sin credenciales ni scopes';
  exception when check_violation then
    null;
  end;

  update public.processing_runs set status = 'COMPLETED', finished_at = now() where id = run_a;
  if not exists (select 1 from public.processing_runs where id = run_a and status = 'COMPLETED') then
    raise exception 'No se pudo finalizar la ejecución';
  end if;
end;
$verify$;
rollback;
select true as remote_smoke_completed_with_rollback;
