import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useMediaQuery } from '@/hooks/use-media-query';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';

export function NavigationLayout({
  userId,
  visible,
  sidebar,
  children,
}: {
  userId: string;
  visible: boolean;
  sidebar: ReactNode;
  children: ReactNode;
}) {
  const desktop = useMediaQuery('(min-width: 1024px)');
  const showNavigation = desktop && visible;
  const key = 'apmail-navigation-width:' + userId;
  const storedWidth = useMemo(() => {
    try {
      const width = Number(localStorage.getItem(key));
      if (Number.isFinite(width) && width >= 240 && width <= 480) return width;
      // Preserve preferences from the former percentage-based layout.
      const legacy: unknown = JSON.parse(
        localStorage.getItem(
          'react-resizable-panels:apmail-navigation:' + userId + ':navigation:workspace',
        ) ?? 'null',
      );
      if (
        legacy &&
        typeof legacy === 'object' &&
        'navigation' in legacy &&
        typeof legacy.navigation === 'number'
      )
        return Math.max(240, Math.min(480, (window.innerWidth * legacy.navigation) / 100));
    } catch {
      /* Local preferences must not prevent navigation. */
    }
    return 300;
  }, [key, userId]);
  const [adjusted, setAdjusted] = useState<{ key: string; width: number } | null>(null);
  const width = adjusted?.key === key ? adjusted.width : storedWidth;
  const navigation = useRef<HTMLDivElement | null>(null);
  return (
    <ResizablePanelGroup
      orientation="horizontal"
      className="h-dvh min-h-0 overflow-hidden"
      onLayoutChanged={(_layout, meta) => {
        if (!showNavigation || !meta.isUserInteraction) return;
        const pixels = navigation.current?.getBoundingClientRect().width;
        if (!pixels || !Number.isFinite(pixels)) return;
        const next = Math.max(240, Math.min(480, Math.round(pixels)));
        setAdjusted({ key, width: next });
        try {
          localStorage.setItem(key, String(next));
        } catch {
          /* Optional UI preference. */
        }
      }}
    >
      {showNavigation && (
        <>
          <ResizablePanel
            id="navigation"
            elementRef={navigation}
            defaultSize={width + 'px'}
            minSize="240px"
            maxSize="480px"
            groupResizeBehavior="preserve-pixel-size"
          >
            <aside className="h-full min-h-0 border-r bg-sidebar text-sidebar-foreground">
              {sidebar}
            </aside>
          </ResizablePanel>
          <ResizableHandle
            withHandle
            aria-label="Ajustar largura do menu"
            title="Arraste para ajustar o menu; use as setas pelo teclado"
            className="w-1 bg-sidebar hover:bg-primary/30"
          />
        </>
      )}
      <ResizablePanel id="workspace" minSize={showNavigation ? '50%' : 0}>
        {children}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
