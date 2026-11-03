-- Personal navigation never changes shared mailbox or provider hierarchy.
CREATE TABLE mail_navigation_preferences (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  config jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(config) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);
CREATE TRIGGER mail_navigation_preferences_updated BEFORE UPDATE ON mail_navigation_preferences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE mail_navigation_preferences ENABLE ROW LEVEL SECURITY;
-- API uses its server-only owner connection and validates mailbox/folder access for every action.
-- Non-owner database sessions must explicitly carry both authenticated identifiers.
CREATE POLICY mail_navigation_own ON mail_navigation_preferences
  USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid
    AND tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.user_id = mail_navigation_preferences.user_id
      AND tm.tenant_id = mail_navigation_preferences.tenant_id AND tm.status = 'active'))
  WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid
    AND tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.user_id = mail_navigation_preferences.user_id
      AND tm.tenant_id = mail_navigation_preferences.tenant_id AND tm.status = 'active'));
REVOKE ALL ON mail_navigation_preferences FROM PUBLIC;
