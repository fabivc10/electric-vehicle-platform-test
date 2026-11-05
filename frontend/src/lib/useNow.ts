import { useEffect, useState } from 'react';

/** Re-renderiza cada `intervalMs` (relojes, "hace X s", duración de sesión). */
export const useNow = (intervalMs = 1000) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
};
