/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PROXY_BASE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
