import * as Sentry from '@sentry/electron/renderer';

if (window.electron.SENTRY_ENABLED) {
  // Defer initialization to prioritize initial render
  setTimeout(() => {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
    });
  }, 2000);
}

import '@/App';
