// Blocking, same-origin script: resolve the theme before CSS and React under script-src 'self'.
try {
  const preference = localStorage.getItem('qqh-theme');
  document.documentElement.dataset.theme =
    preference === 'light' || preference === 'dark'
      ? preference
      : matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
} catch {
  document.documentElement.dataset.theme = matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}
