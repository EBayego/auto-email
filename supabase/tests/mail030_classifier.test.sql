begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select ok(public.valid_classifier_exclusions('{}', '{}'), 'Permite listas vacías');
select ok(public.valid_classifier_exclusions(array['contact@example.invalid'], array['news.invalid']), 'Permite exclusiones válidas');
select ok(public.valid_classifier_exclusions('{}', array['xn--espaa-rta.es']), 'Permite dominios IDN normalizados');
select ok(not public.valid_classifier_exclusions(array['CONTACT@example.invalid'], '{}'), 'Exige direcciones normalizadas');
select ok(not public.valid_classifier_exclusions('{}', array['EXAMPLE.invalid']), 'Exige dominios normalizados');
select ok(not public.valid_classifier_exclusions(array['bad@@example.invalid'], '{}'), 'Rechaza dirección mal formada');
select ok(not public.valid_classifier_exclusions('{}', array['*.example.invalid']), 'No admite comodines');
select ok(not public.valid_classifier_exclusions('{}', array['a..invalid']), 'No admite etiquetas vacías');
select ok(not public.valid_classifier_exclusions('{}', array[repeat('a',64) || '.invalid']), 'Límite de etiqueta DNS');
select ok(not public.valid_classifier_exclusions(array[null::text], '{}'), 'No admite direcciones nulas');
select ok(not public.valid_classifier_exclusions('{}', array[null::text]), 'No admite dominios nulos');
select ok(not public.valid_classifier_exclusions('{}', array_fill('example.invalid'::text, array[101])), 'Máximo 100 reglas por lista');
select ok(not public.valid_classifier_exclusions('{}', array[['a.invalid','b.invalid']]), 'No admite listas multidimensionales');
select ok(not has_function_privilege('anon','public.valid_classifier_exclusions(text[],text[])','EXECUTE'), 'Función restringida a backend');
select ok(has_column_privilege('authenticated','public.user_settings','classifier_excluded_domains','SELECT'), 'El titular puede leer sus reglas con RLS');
select ok(not has_column_privilege('authenticated','public.user_settings','classifier_excluded_domains','UPDATE'), 'El navegador no modifica reglas directamente');

insert into auth.users(id,aud,role,email) values ('00000000-0000-4000-8000-000000000030','authenticated','authenticated','mail030@example.invalid');
select is((select cardinality(classifier_excluded_domains) from public.user_settings where user_id='00000000-0000-4000-8000-000000000030'),0,'Sin exclusiones por defecto');
select throws_ok($q$update public.user_settings set classifier_excluded_domains=array['*.invalid'] where user_id='00000000-0000-4000-8000-000000000030'$q$,
  '23514',null::text,'La restricción protege también escrituras SQL');
select lives_ok($q$update public.user_settings set classifier_excluded_addresses=array['contact@example.invalid'], classifier_excluded_domains=array['news.invalid'] where user_id='00000000-0000-4000-8000-000000000030'$q$, 'El backend puede guardar reglas válidas');
select * from finish();
rollback;
