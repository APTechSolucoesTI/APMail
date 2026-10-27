import type { ComponentProps } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

/** Compact mail actions keep their accessible name and a keyboard/mouse hint. */
export function MailActionButton({
  label,
  children,
  ...props
}: ComponentProps<typeof Button> & { label: string }) {
  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            {...props}
            size="icon"
            variant="mail-action"
            aria-label={props['aria-label'] ?? label}
          >
            {children}
          </Button>
        </TooltipTrigger>
        <TooltipContent sideOffset={6}>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
