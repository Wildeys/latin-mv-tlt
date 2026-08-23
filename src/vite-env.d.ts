/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_EN_REALIZE_MODEL?: string;
  readonly VITE_DV_REALIZE_MODEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
