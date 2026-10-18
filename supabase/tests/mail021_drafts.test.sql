begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-000000000211', 'authenticated', 'authenticated', 'mail021-a@example.invalid'),
  ('00000000-0000-4000-8000-000000000212', 'authenticated', 'authenticated', 'mail021-b@example.invalid');
insert into public.gmail_accounts (id, user_id, email, status, encrypted_refresh_token, scope_set) values
  ('10000000-0000-4000-8000-000000000211', '00000000-0000-4000-8000-000000000211', 'mail021-a@example.invalid', 'CONNECTED', '\x74657374', array['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.compose']),
  ('10000000-0000-4000-8000-000000000212', '00000000-0000-4000-8000-000000000212', 'mail021-b@example.invalid', 'CONNECTED', '\x74657374', array['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.compose']);
insert into public.draft_generations (id, user_id, gmail_account_id, thread_id, target_message_id, style_revision, model, prompt_version, input_tokens, output_tokens) values
  ('20000000-0000-4000-8000-000000000211', '00000000-0000-4000-8000-000000000211', '10000000-0000-4000-8000-000000000211', 'thread-a', 'target-a', gen_random_uuid(), 'test-model', 'mail020-v1', 10, 10),
  ('20000000-0000-4000-8000-000000000212', '00000000-0000-4000-8000-000000000212', '10000000-0000-4000-8000-000000000212', 'thread-b', 'target-b', gen_random_uuid(), 'test-model', 'mail020-v1', 10, 10);

grant usage on schema extensions to authenticated, anon;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000211","role":"authenticated"}';
select is((select count(*) from public.draft_generations), 1::bigint, 'Solo se leen los IDs y estados del propietario');
select is((select count(*) from public.draft_generations where user_id='00000000-0000-4000-8000-000000000212'), 0::bigint, 'No se accede a registros ajenos conociendo su ID');
select throws_ok($q$update public.draft_generations set status='UNCERTAIN', reason_code='GMAIL_WRITE_UNCERTAIN'$q$, '42501', null::text, 'El navegador no puede cambiar el estado');
select throws_ok($q$delete from public.draft_generations$q$, '42501', null::text, 'El navegador no puede borrar la idempotencia');
select throws_ok($q$insert into public.draft_generations default values$q$, '42501', null::text, 'El navegador no puede reservar una escritura');
reset role;
update public.gmail_accounts set status='DISCONNECTED' where user_id='00000000-0000-4000-8000-000000000211';
set local role authenticated;
select is((select count(*) from public.draft_generations), 0::bigint, 'Una cuenta desconectada no expone sus registros');
reset role;
update public.gmail_accounts set status='CONNECTED' where user_id='00000000-0000-4000-8000-000000000211';
update public.users set status='DISABLED' where id='00000000-0000-4000-8000-000000000211';
set local role authenticated;
select is((select count(*) from public.draft_generations), 0::bigint, 'Un usuario deshabilitado no accede a registros');
reset role;
update public.users set status='ACTIVE' where id='00000000-0000-4000-8000-000000000211';
set local role anon;
select throws_ok($q$select * from public.draft_generations$q$, '42501', null::text, 'Anon no lee los registros');
reset role;

set local role service_role;
update public.draft_generations set prompt_version='mail020-v2' where user_id in ('00000000-0000-4000-8000-000000000211','00000000-0000-4000-8000-000000000212');
select is((select count(*) from public.draft_generations where prompt_version='mail020-v2' and user_id in ('00000000-0000-4000-8000-000000000211','00000000-0000-4000-8000-000000000212')), 2::bigint, 'Se registra la revisión de instrucciones validada en MAIL-022');
update public.draft_generations set prompt_version='mail020-v1' where user_id in ('00000000-0000-4000-8000-000000000211','00000000-0000-4000-8000-000000000212');
select throws_ok($q$update public.draft_generations set prompt_version='unknown-version' where thread_id='thread-a'$q$, '23514', null::text, 'No se registran versiones de prompt desconocidas');
update public.draft_generations set thread_id=repeat('x',512),target_message_id=repeat('y',512) where thread_id='thread-b';
select is((select count(*) from public.draft_generations where char_length(thread_id)=512 and char_length(target_message_id)=512), 1::bigint, 'Los IDs largos válidos se aceptan en Postgres');
select throws_ok($q$update public.draft_generations set thread_id=repeat('x',513)$q$, '23514', null::text, 'Se limita la longitud de IDs a 512 caracteres');
select throws_ok($q$update public.draft_generations set user_id='00000000-0000-4000-8000-000000000211' where user_id='00000000-0000-4000-8000-000000000212'$q$, '23503', null::text, 'La FK impide mezclar cuenta y propietario');
select throws_ok($q$update public.draft_generations set status='CREATED'$q$, '23514', null::text, 'CREATED necesita ambos IDs de Google');
select throws_ok($q$update public.draft_generations set status='CANCELLED'$q$, '23514', null::text, 'CANCELLED necesita motivo');
select throws_ok($q$update public.draft_generations set input_tokens=-1$q$, '23514', null::text, 'Las métricas no admiten negativos');
select throws_ok($q$update public.draft_generations set reason_code='private-body'$q$, '23514', null::text, 'Los motivos no admiten contenido de correo');
select throws_ok($q$update public.draft_generations set draft_id='invalid id'$q$, '23514', null::text, 'Los IDs externos se validan');
select throws_ok($q$insert into public.draft_generations (id,user_id,gmail_account_id,thread_id,target_message_id,style_revision,model,prompt_version,input_tokens,output_tokens) select gen_random_uuid(),user_id,gmail_account_id,'other-thread',target_message_id,style_revision,model,prompt_version,10,10 from public.draft_generations where thread_id='thread-a'$q$, '23505', null::text, 'Un objetivo solo puede tener un intento');
select throws_ok($q$insert into public.draft_generations (id,user_id,gmail_account_id,thread_id,target_message_id,style_revision,model,prompt_version,input_tokens,output_tokens) select gen_random_uuid(),user_id,gmail_account_id,thread_id,'other-target',style_revision,model,prompt_version,10,10 from public.draft_generations where thread_id='thread-a'$q$, '23505', null::text, 'Dos procesos no pueden escribir a la vez en el hilo');
update public.draft_generations set status='UNCERTAIN',reason_code='GMAIL_WRITE_UNCERTAIN' where thread_id='thread-a';
select throws_ok($q$insert into public.draft_generations (id,user_id,gmail_account_id,thread_id,target_message_id,style_revision,model,prompt_version,input_tokens,output_tokens) select gen_random_uuid(),user_id,gmail_account_id,thread_id,'other-target',style_revision,model,prompt_version,10,10 from public.draft_generations where thread_id='thread-a'$q$, '23505', null::text, 'Un POST incierto mantiene el bloqueo del hilo');
update public.draft_generations set status='CREATED',reason_code=null,draft_id='r-stable',draft_message_id='gmail-message',verified_at=now() where thread_id='thread-a';
select is((select count(*) from public.draft_generations where draft_id='r-stable' and verified_at is not null), 1::bigint, 'El ID estable y la verificación quedan registrados');
select is((select count(*) from information_schema.columns where table_schema='public' and table_name='draft_generations' and column_name in ('body','body_text','raw','prompt','subject','recipient')), 0::bigint, 'No hay columnas de contenido de correos');
reset role;
delete from auth.users where id='00000000-0000-4000-8000-000000000211';
select is((select count(*) from public.draft_generations where user_id='00000000-0000-4000-8000-000000000211'), 0::bigint, 'La baja elimina los metadatos del usuario');
select * from finish();
rollback;
