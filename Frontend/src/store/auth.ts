import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface AuthState {
  isAuthenticated: boolean;
  token: string | null;
  userId: string | null;
  login: (token: string, userId: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      isAuthenticated: false,
      token: null,
      userId: null,
      login: (token: string, userId: string) =>
        set({ isAuthenticated: true, token, userId }),
      logout: () =>
        set({ isAuthenticated: false, token: null, userId: null }),
    }),
    {
      name: 'auth-storage',
    }
  )
);
