CREATE TABLE mailbox_purge_requests(
  mailbox_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  requested_by uuid NOT NULL REFERENCES users(id),
  state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','completed','failed')),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(mailbox_id,tenant_id) REFERENCES mailboxes(id,tenant_id)
);
