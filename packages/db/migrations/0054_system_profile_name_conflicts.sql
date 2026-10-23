-- Keep existing custom profile names and ensure each company still receives all system roles.
DO $$ DECLARE company record; standard record; candidate text; suffix integer; BEGIN
 FOR company IN SELECT id FROM tenants LOOP
  FOR standard IN SELECT * FROM (VALUES ('owner','Proprietário',ARRAY['mail','mail.send','mail.organize','mail.move','mail.delete','mail.restore','mail.flag','contacts','contacts.create','contacts.edit','contacts.delete','chat','calendar','reminders','schedules','reports','users.view','users.invite','users.manage','profiles.manage','audit.view','audit.content','mailboxes.manage','company.manage','integrations','signatures','labels','rules','archives']::text[]),('admin','Administrador',ARRAY['mail','mail.send','mail.organize','mail.move','mail.delete','mail.restore','mail.flag','contacts','contacts.create','contacts.edit','contacts.delete','chat','calendar','reminders','schedules','reports','users.view','users.invite','users.manage','profiles.manage','audit.view','audit.content','mailboxes.manage','company.manage','integrations','signatures','labels','rules','archives']::text[]),('supervisor','Supervisor',ARRAY['mail','mail.send','mail.organize','mail.move','mail.delete','mail.restore','mail.flag','contacts','contacts.create','contacts.edit','chat','calendar','reminders','schedules','reports','integrations','signatures','labels','rules','users.view','audit.view','contacts.delete']::text[]),('member','Membro',ARRAY['mail','mail.send','mail.organize','mail.move','mail.delete','mail.restore','mail.flag','contacts','contacts.create','contacts.edit','chat','calendar','reminders','schedules','reports','integrations','signatures','labels','rules']::text[])) AS defaults(role,name,permissions) LOOP
   IF NOT EXISTS(SELECT 1 FROM access_profiles WHERE tenant_id=company.id AND system_role=standard.role) THEN
    candidate=standard.name; suffix=0;
    WHILE EXISTS(SELECT 1 FROM access_profiles WHERE tenant_id=company.id AND lower(name)=lower(candidate)) LOOP
     suffix=suffix+1; candidate=standard.name||' (sistema '||suffix||')';
    END LOOP;
    INSERT INTO access_profiles(tenant_id,name,description,permissions,system_role) VALUES(company.id,candidate,'Perfil padrão do sistema. Duplique para personalizar.',standard.permissions,standard.role);
   END IF;
  END LOOP;
 END LOOP;
END $$;
