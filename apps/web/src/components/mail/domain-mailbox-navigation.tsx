import { useQuery } from '@tanstack/react-query';
import { meQuery, type Mailbox } from '@/lib/auth';
import { groupMailboxesByDomain } from '@/lib/mailbox-groups';
import { NavigationGroup } from '@/components/layout/navigation-group';
import { MailboxFolderNavigation } from './mailbox-folder-navigation';
import { Globe2 } from 'lucide-react';
import { useLocation } from '@tanstack/react-router';
import { useMailNavigation } from '@/hooks/use-mail-navigation';
import { orderedItems } from '@/lib/mail-drag';
import { MailboxReorder } from './mailbox-reorder';
export function DomainMailboxNavigation({
  boxes,
  onNavigate,
}: {
  boxes: Mailbox[];
  onNavigate: () => void;
}) {
  const me = useQuery(meQuery).data,
    location = useLocation();
  const navigation = useMailNavigation();
  const ordered = orderedItems(boxes, navigation.config.mailbox_order);
  const renderBox = (box: Mailbox, siblings: Mailbox[] = ordered) => (
    <MailboxReorder key={box.id} box={box} siblings={siblings} allBoxes={ordered}>
      <MailboxFolderNavigation box={box} onNavigate={onNavigate} />
    </MailboxReorder>
  );
  const warning = navigation.isError ? (
    <p role="alert" className="p-2 text-xs text-muted-foreground">
      Não foi possível carregar sua organização.{' '}
      <button
        type="button"
        className="text-primary underline"
        onClick={() => void navigation.retry()}
      >
        Tentar novamente
      </button>
    </p>
  ) : null;
  if (!me?.preferences.mail_group_by_domain)
    return (
      <>
        {warning}
        {ordered.map((box) => renderBox(box))}
      </>
    );
  return (
    <>
      {warning}
      {groupMailboxesByDomain(ordered).map((group) => (
        <NavigationGroup
          key={group.domain}
          id={'domain-' + group.domain}
          label={group.domain}
          icon={<Globe2 className="size-4" />}
          defaultOpen={group.mailboxes.some((b) => location.pathname === '/mail/' + b.id)}
          indentContent
        >
          {ordered
            .filter((box) => group.mailboxes.some((member) => member.id === box.id))
            .map((box) =>
              renderBox(
                box,
                ordered.filter((member) =>
                  group.mailboxes.some((groupBox) => groupBox.id === member.id),
                ),
              ),
            )}
        </NavigationGroup>
      ))}
    </>
  );
}
