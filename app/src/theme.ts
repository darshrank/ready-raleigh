// Light or Dark (DESIGN.md "two moods"): the player's choice of map. Light is the printed day
// board, and in the storm the map follows the city's clock (day, dusk, night, dawn). Dark keeps
// the night palette everywhere. Plates stay bond and ink in both: the night palette is the map,
// not a UI theme. The choice is remembered.
import { create } from 'zustand';

export type Theme = 'light' | 'dark';

const KEY = 'ready-raleigh:theme';

function initialTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export const useTheme = create<{ theme: Theme; toggle: () => void }>((set, get) => ({
  theme: initialTheme(),
  toggle: () => {
    const theme: Theme = get().theme === 'dark' ? 'light' : 'dark';
    set({ theme });
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      // Not remembered; still applies now.
    }
  },
}));
