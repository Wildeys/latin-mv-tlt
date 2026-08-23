import { useEffect, useState } from 'react';

export function useDarkMode() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  return { dark, toggle: () => setDark((d) => !d) };
}
