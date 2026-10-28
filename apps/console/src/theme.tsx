import { useEffect, useState } from 'react';
type Theme = 'light' | 'dark' | 'system';
export function ThemeSelector() {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const v = localStorage.getItem('qqh-theme');
      return v === 'light' || v === 'dark' ? v : 'system';
    } catch {
      return 'system';
    }
  });
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.dataset.theme =
        theme === 'system' ? (media.matches ? 'dark' : 'light') : theme;
      document.documentElement.dataset.themePreference = theme;
    };
    apply();
    try {
      localStorage.setItem('qqh-theme', theme);
    } catch {
      /* Storage may be disabled. */
    }
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
  return (
    <select aria-label="界面主题" value={theme} onChange={(e) => setTheme(e.target.value as Theme)}>
      <option value="light">亮色</option>
      <option value="dark">暗色</option>
      <option value="system">跟随系统</option>
    </select>
  );
}
