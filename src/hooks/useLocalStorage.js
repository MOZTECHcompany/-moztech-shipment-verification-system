import { useState, useEffect } from 'react';

export function useLocalStorage(key, defaultValue) {
  const [state, setState] = useState(() => {
    try {
      const storedValue = window.localStorage.getItem(key);
      return storedValue ? JSON.parse(storedValue) : defaultValue;
    } catch (error) {
      return defaultValue;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(state));
    } catch (error) {
      // 儲存失敗時靜默處理，避免中斷 UI
    }
  }, [key, state]);

  return [state, setState];
}