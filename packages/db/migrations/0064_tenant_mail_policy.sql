UPDATE tenants SET settings=jsonb_set(settings,'{mail_queues_enabled}','true') WHERE NOT settings ? 'mail_queues_enabled';
CREATE TABLE tenant_mail_policy_runs (
 tenant_id uuid PRIMARY KEY REFERENCES tenants(id), generation uuid NOT NULL,
 state text NOT NULL CHECK(state IN('queued','running','succeeded','failed','superseded')),
 after_thread_id uuid, processed integer NOT NULL DEFAULT 0,
 started_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz, error text
);
