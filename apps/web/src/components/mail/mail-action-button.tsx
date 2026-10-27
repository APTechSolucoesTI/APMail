import type { ComponentProps } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

/** Mail actions keep visible names; small row controls can explicitly use only an icon. */
export function MailActionButton({
  label,
  text = label,
  iconOnly = false,
  children,
  ...props
}: ComponentProps<typeof Button> & { label: string; text?: string; iconOnly?: boolean }) {
  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            {...props}
            size={iconOnly ? 'icon' : 'sm'}
            variant="mail-action"
            aria-label={props['aria-label'] ?? label}
          >
            {children}
            {!iconOnly && <span>{text}</span>}
          </Button>
        </TooltipTrigger>
        <TooltipContent sideOffset={6}>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
