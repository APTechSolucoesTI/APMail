import { useQuery } from '@tanstack/react-query';
import { meQuery, type Mailbox } from '@/lib/auth';
import { groupMailboxesByDomain } from '@/lib/mailbox-groups';
import { NavigationGroup } from '@/components/layout/navigation-group';
import { MailboxFolderNavigation } from './mailbox-folder-navigation';
import { Globe2 } from 'lucide-react';
import { useLocation } from '@tanstack/react-router';
export function DomainMailboxNavigation({
  boxes,
  onNavigate,
}: {
  boxes: Mailbox[];
  onNavigate: () => void;
}) {
  const me = useQuery(meQuery).data,
    location = useLocation();
  if (!me?.preferences.mail_group_by_domain)
    return boxes.map((box) => (
      <MailboxFolderNavigation key={box.id} box={box} onNavigate={onNavigate} />
    ));
  return groupMailboxesByDomain(boxes).map((group) => (
    <NavigationGroup
      key={group.domain}
      id={'domain-' + group.domain}
      label={group.domain}
      icon={<Globe2 className="size-4" />}
      defaultOpen={group.mailboxes.some((b) => location.pathname === '/mail/' + b.id)}
      indentContent
    >
      {group.mailboxes.map((box) => (
        <MailboxFolderNavigation key={box.id} box={box} onNavigate={onNavigate} />
      ))}
    </NavigationGroup>
  ));
}
