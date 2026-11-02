-- Remote projects may grant ALL to service_role by default, unlike the local
-- configuration. Replace those defaults with the metadata store's actual needs.
revoke all on public.generation_runs from service_role;
grant select,insert,delete on public.generation_runs to service_role;
grant update(configuration) on public.generation_runs to service_role;
