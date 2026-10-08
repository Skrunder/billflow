import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { AuthProvider, LocalAuthProvider } from './auth/AuthProvider';
import { ToastProvider } from './components/ui/Toast';
import { RepositoryProvider } from './data/RepositoryProvider';
import { DeviceNavigator, isNativeApp } from './native/device';
import type { DataRepository } from './data/repository';
import './index.css';
import { CACHE_MAX_AGE, persister, queryClient } from './queryClient';

// Service worker: offline app shell + push notifications. Updates apply automatically.
// Not in the Android app, which ships its files inside the APK.
if ('serviceWorker' in navigator && import.meta.env.PROD && !isNativeApp()) {
  registerSW({ immediate: true });
}

/**
 * Data source: the self-hosted server (default) or, in the "standalone"
 * build, the on-device database with no account at all.
 */
const STANDALONE = import.meta.env.VITE_DATA_SOURCE === 'local';

function Shell({ children }: { children: ReactNode }) {
  return (
    <StrictMode>
      <PersistQueryClientProvider client={queryClient} persistOptions={{ persister, maxAge: CACHE_MAX_AGE, buster: __APP_VERSION__ }}>
        <BrowserRouter>
          <DeviceNavigator />
          <ToastProvider>{children}</ToastProvider>
        </BrowserRouter>
      </PersistQueryClientProvider>
    </StrictMode>
  );
}

async function bootstrap() {
  const root = createRoot(document.getElementById('root')!);
  if (!STANDALONE) {
    root.render(
      <Shell>
        <AuthProvider>
          <RepositoryProvider>
            <App />
          </RepositoryProvider>
        </AuthProvider>
      </Shell>,
    );
    return;
  }

  try {
    const [{ openDeviceRepository }, { SyncProvider }] = await Promise.all([import('./data/local/browser'), import('./sync/SyncProvider')]);
    const repository = await openDeviceRepository();
    const { user } = await repository.getProfile();
    root.render(
      <Shell>
        <LocalAuthProvider user={user}>
          <RepositoryProvider repository={repository as DataRepository}>
            <SyncProvider repo={repository}>
              <App />
            </SyncProvider>
          </RepositoryProvider>
        </LocalAuthProvider>
      </Shell>,
    );
  } catch (err) {
    console.error(err);
    root.render(
      <div role="alert" style={{ padding: 24, fontFamily: 'system-ui' }}>
        <h1>Could not open your data</h1>
        <p>{(err as Error).message}</p>
      </div>,
    );
  }
}

void bootstrap();
