import type { ReactNode } from 'react';
import type { GroupProps, PanelProps } from 'react-resizable-panels';
import { beforeEach, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { NavigationLayout } from './navigation-layout';
const boundary = vi.hoisted(() => ({ group: {} as GroupProps, navigation: {} as PanelProps }));
vi.mock('@/hooks/use-media-query', () => ({ useMediaQuery: () => true }));
vi.mock('@/components/ui/resizable', () => ({
  ResizablePanelGroup: (props: GroupProps) => {
    boundary.group = props;
    return <div>{props.children}</div>;
  },
  ResizablePanel: (props: PanelProps) => {
    if (props.id === 'navigation') boundary.navigation = props;
    const ref = (element: HTMLDivElement | null) => {
      if (element) element.getBoundingClientRect = () => ({ width: 380 }) as DOMRect;
      if (typeof props.elementRef === 'function') props.elementRef(element);
      else if (props.elementRef) props.elementRef.current = element;
    };
    return <div ref={ref}>{props.children as ReactNode}</div>;
  },
  ResizableHandle: () => null,
}));
beforeEach(() => localStorage.clear());
it('salva a largura real em pixels e restaura para o mesmo usuário após reabrir', () => {
  const open = (userId: string) =>
    render(
      <NavigationLayout userId={userId} visible sidebar="Menu">
        Conteúdo
      </NavigationLayout>,
    );
  const view = open('one');
  act(() =>
    boundary.group.onLayoutChanged?.(
      { navigation: 30, workspace: 70 },
      { isUserInteraction: true },
    ),
  );
  view.unmount();
  const reopened = open('one');
  expect(boundary.navigation.defaultSize).toBe('380px');
  reopened.unmount();
  open('other');
  expect(boundary.navigation.defaultSize).toBe('300px');
});
