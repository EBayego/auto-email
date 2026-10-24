begin;
create extension if not exists pgtap with schema extensions;
select plan(2);
select ok((select pg_get_constraintdef(oid) like '%epic06-v1%' from pg_constraint
  where conrelid='public.draft_generations'::regclass and conname='draft_generations_prompt_version_check'),
  'EPIC-06 permite registrar la versión que aplica el permiso del historial');
select ok((select pg_get_constraintdef(oid) like '%mail041-v1%' and pg_get_constraintdef(oid) like '%mail020-v1%'
  from pg_constraint where conrelid='public.draft_generations'::regclass and conname='draft_generations_prompt_version_check'),
  'EPIC-06 conserva la trazabilidad de las generaciones anteriores');
select * from finish();
rollback;
