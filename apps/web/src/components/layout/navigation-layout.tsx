import type { ReactNode } from 'react';
import { useDefaultLayout } from 'react-resizable-panels';
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
  const layout = useDefaultLayout({
    id: 'apmail-navigation:' + userId,
    panelIds: showNavigation ? ['navigation', 'workspace'] : ['workspace'],
    storage: localStorage,
    onlySaveAfterUserInteractions: true,
  });
  return (
    <ResizablePanelGroup
      orientation="horizontal"
      className="h-dvh min-h-0 overflow-hidden"
      defaultLayout={layout.defaultLayout}
      onLayoutChanged={layout.onLayoutChanged}
    >
      {showNavigation && (
        <>
          <ResizablePanel
            id="navigation"
            defaultSize="300px"
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
