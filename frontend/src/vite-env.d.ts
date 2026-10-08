/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  /** "local" builds the standalone app (on-device database, no server). */
  readonly VITE_DATA_SOURCE?: 'remote' | 'local';
}
