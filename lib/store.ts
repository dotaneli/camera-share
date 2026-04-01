import { create } from 'zustand';

export type Role = 'camera' | 'viewfinder' | null;

interface AppState {
  role: Role;
  setRole: (role: Role) => void;
  resetRole: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  role: null,
  setRole: (role) => set({ role }),
  resetRole: () => set({ role: null }),
}));
