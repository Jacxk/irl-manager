'use client';
import { createContext, useContext, useEffect } from 'react';
const Defaults = createContext({
  theme: 'system' as 'light' | 'dark' | 'system',
  language: 'en',
  timezone: 'UTC',
  hour12: false,
  instanceName: 'IRL Manager',
  logoUrl: '',
  minPasswordLength: 10,
});
export const useDisplayDefaults = () => useContext(Defaults);
export function InstanceDisplay({
  defaults,
  children,
}: {
  defaults: {
    theme: 'light' | 'dark' | 'system';
    language: string;
    timezone: string;
    hour12: boolean;
    instanceName: string;
    logoUrl: string;
    minPasswordLength: number;
  };
  children: React.ReactNode;
}) {
  useEffect(() => {
    window.dispatchEvent(new Event('irl-theme-set'));
  }, [defaults.theme]);
  return <Defaults.Provider value={defaults}>{children}</Defaults.Provider>;
}
