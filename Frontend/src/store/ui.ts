import { create } from 'zustand';

export interface UIState {
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  setSidebar: (open: boolean) => void;
  selectedEntityId: string | null;
  setSelectedEntity: (id: string | null) => void;
  entityModalOpen: boolean;
  setEntityModalOpen: (open: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebar: (open: boolean) => set({ sidebarOpen: open }),
  selectedEntityId: null,
  setSelectedEntity: (id: string | null) => set({ selectedEntityId: id }),
  entityModalOpen: false,
  setEntityModalOpen: (open: boolean) => set({ entityModalOpen: open }),
}));
