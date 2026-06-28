function createThemeController(themeToggle) {
  function applyTheme(theme) {
    const icon = themeToggle.querySelector('.theme-icon');
    if (theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
      icon.innerHTML = '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
      icon.innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
      localStorage.setItem('theme', 'light');
    }
  }

  function initTheme() {
    const saved = localStorage.getItem('theme') || 'light';
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = saved === 'dark' || (saved === 'auto' && prefersDark) ? 'dark' : 'light';
    applyTheme(theme);
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    applyTheme(current === 'dark' ? 'light' : 'dark');
  }

  themeToggle.addEventListener('click', toggleTheme);
  return { initTheme, toggleTheme };
}