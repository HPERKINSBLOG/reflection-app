import { useEffect, useState } from 'react';

const preferenceKey = 'reflection-theme';
export type ThemePreference = 'system' | 'paper' | 'evening';

function parsePreference(value: string | null): ThemePreference {
  return value === 'paper' || value === 'evening' ? value : 'system';
}

export function readThemePreference(): ThemePreference {
  try {
    return parsePreference(localStorage.getItem(preferenceKey));
  } catch {
    return 'system';
  }
}

export function applyTheme(preference: ThemePreference) {
  if (preference === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = preference;
}

export function ThemeSelect() {
  const [preference, setPreference] = useState(readThemePreference);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key !== preferenceKey && event.key !== null) return;
      const next = readThemePreference();
      applyTheme(next);
      setPreference(next);
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  return (
    <label className="theme-control">
      <span className="sr-only">Color theme</span>
      <select
        value={preference}
        onChange={(event) => {
          const next = parsePreference(event.target.value);
          applyTheme(next);
          setPreference(next);
          try {
            if (next === 'system') localStorage.removeItem(preferenceKey);
            else localStorage.setItem(preferenceKey, next);
          } catch {}
        }}
      >
        <option value="system">System</option>
        <option value="paper">Paper</option>
        <option value="evening">Evening</option>
      </select>
    </label>
  );
}
