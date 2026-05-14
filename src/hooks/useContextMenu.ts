import { useState, useCallback } from 'react';
import { ContextMenuItem } from '../components/ContextMenu';

interface ContextMenuState {
  items: ContextMenuItem[];
  position: { x: number; y: number };
  isOpen: boolean;
}

export const useContextMenu = () => {
  const [menu, setMenu] = useState<ContextMenuState | null>(null);

  const showMenu = useCallback((items: ContextMenuItem[], event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    
    setMenu({
      items,
      position: { x: event.clientX, y: event.clientY },
      isOpen: true,
    });
  }, []);

  const hideMenu = useCallback(() => {
    setMenu(null);
  }, []);

  return {
    menu,
    showMenu,
    hideMenu,
    isOpen: menu?.isOpen ?? false,
  };
};
