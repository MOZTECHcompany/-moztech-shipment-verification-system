// Warehouse credentials belong to this tab, never to a different work station.
import { useState, useEffect } from 'react';

export function useWarehouseSession(key, defaultValue) {
  const [state, setState] = useState(() => {
    try {
      const storedValue = window.sessionStorage.getItem(key);
      return storedValue ? JSON.parse(storedValue) : defaultValue;
    } catch (error) {
      return defaultValue;
    }
  });

  useEffect(() => {
    try {
      window.sessionStorage.setItem(key, JSON.stringify(state));
    } catch (error) {}
  }, [key, state]);

  return [state, setState];
}