import { createContext, useContext } from 'react';

interface NavigationContextValue {
  goToSymbol: (symbol: string) => void;
  goHome: () => void;
}

export const NavigationContext = createContext<NavigationContextValue>({
  goToSymbol: () => {},
  goHome: () => {},
});

export function useNavigation() {
  return useContext(NavigationContext);
}
