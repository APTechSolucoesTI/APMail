-- The platform creates an owner invitation when the company's owner has no account yet.
-- Ordinary tenant invitations must continue to exclude the owner role.
alter table invitations drop constraint invitations_tenant_role_check;
alter table invitations add constraint invitations_tenant_role_check
  check (tenant_role <> 'owner' or sender_context = 'platform');
