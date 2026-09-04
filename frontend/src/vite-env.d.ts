/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Absolute URL of the backend API, e.g. https://api.example.com/api.
   *  Defaults to the same-origin '/api' path used by the dev proxy. */
  readonly VITE_API_BASE_URL?: string
  readonly VITE_BASE_PATH?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
