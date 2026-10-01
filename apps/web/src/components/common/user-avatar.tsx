import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
export function UserAvatar({
  name,
  src,
  size = 32,
  online,
}: {
  name: string;
  src?: string | null;
  size?: 20 | 24 | 32 | 40;
  online?: boolean;
}) {
  return (
    <span className="relative inline-flex">
      <Avatar className={cn({ 20: 'size-5', 24: 'size-6', 32: 'size-8', 40: 'size-10' }[size])}>
        {src && <AvatarImage src={src} alt={name} />}
        <AvatarFallback className="text-xs">
          {name
            .split(' ')
            .filter(Boolean)
            .slice(0, 2)
            .map((s) => s[0])
            .join('')
            .toUpperCase()}
        </AvatarFallback>
      </Avatar>
      {online !== undefined && (
        <span
          className={cn(
            'absolute bottom-0 right-0 size-2 rounded-full border border-card',
            online ? 'bg-success' : 'bg-neutral',
          )}
        >
          <span className="sr-only">{online ? 'Online' : 'Offline'}</span>
        </span>
      )}
    </span>
  );
}
