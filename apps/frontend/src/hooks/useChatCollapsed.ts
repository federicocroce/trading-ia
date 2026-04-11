import { useState, useEffect } from 'react';

const STORAGE_KEY = 'chat-collapsed';

export function useChatCollapsed() {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(collapsed));
    } catch {
      // localStorage unavailable, continue without persistence
    }
  }, [collapsed]);

  const toggle = () => setCollapsed((prev) => !prev);

  return { collapsed, toggle };
}
