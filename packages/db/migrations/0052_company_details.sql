-- Optional company registration data; existing operational settings stay untouched.
alter table tenants add column company_details jsonb not null default '{}'::jsonb;
alter table tenants add constraint tenants_company_details_object
  check (jsonb_typeof(company_details) = 'object');
comment on column tenants.company_details is 'Company registration, address and contact data. Validated at API boundaries; no credentials.';
