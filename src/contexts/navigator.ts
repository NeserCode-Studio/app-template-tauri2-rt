import { createContext, useContext } from "react";

export interface NavigatorContextValue {
  navigator: (path: string) => void;
}

export const NavigatorContext = createContext<NavigatorContextValue>({
  navigator: () => {},
});

export function useNavigatorContext() {
  return useContext(NavigatorContext);
}
