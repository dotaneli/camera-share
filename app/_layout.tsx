import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { rlog } from '../lib/remote-logger';

// === CRASH HANDLERS — runs BEFORE any component renders ===

// 1. Global JS error handler (synchronous crashes)
try {
  const originalHandler = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error: any, isFatal?: boolean) => {
    rlog.fatal('crash', isFatal ? 'FATAL JS CRASH' : 'Unhandled JS error', {
      message: error?.message,
      stack: error?.stack?.substring(0, 800),
      isFatal,
    });
    originalHandler(error, isFatal);
  });
} catch (e) {
  // ErrorUtils may not exist in some environments
}

// 2. Unhandled promise rejections (async crashes)
const originalRejectionHandler = (global as any).onunhandledrejection;
(global as any).onunhandledrejection = (event: any) => {
  rlog.fatal('crash', 'Unhandled promise rejection', {
    reason: event?.reason?.message || String(event?.reason),
    stack: event?.reason?.stack?.substring(0, 500),
  });
  if (originalRejectionHandler) originalRejectionHandler(event);
};

// 3. Log that the JS runtime started (if this log appears, JS is alive)
rlog.info('app', 'JS runtime started — _layout.tsx executing');

// === END CRASH HANDLERS ===

export default function RootLayout() {
  useEffect(() => {
    rlog.info('app', 'RootLayout mounted — app is rendering');
  }, []);

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#000' },
          animation: 'slide_from_right',
        }}
      />
    </>
  );
}
