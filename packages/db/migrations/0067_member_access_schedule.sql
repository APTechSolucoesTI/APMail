ALTER TABLE tenant_members ADD COLUMN access_schedule jsonb
  CHECK (access_schedule IS NULL OR (jsonb_typeof(access_schedule) = 'object' AND octet_length(access_schedule::text) <= 262144));
COMMENT ON COLUMN tenant_members.access_schedule IS 'Per-company login/access schedule. NULL is unrestricted. Weekly days indexed Sunday=0; dated exceptions override the entire day. Validated at the API boundary; company timezone applies.';
