'use client';
import { createContext, useContext } from 'react';
const Defaults = createContext({
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
    language: string;
    timezone: string;
    hour12: boolean;
    instanceName: string;
    logoUrl: string;
    minPasswordLength: number;
  };
  children: React.ReactNode;
}) {
  return <Defaults.Provider value={defaults}>{children}</Defaults.Provider>;
}
