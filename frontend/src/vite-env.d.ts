/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Public base path of the site, e.g. '/investment-manager/' on GitHub Pages. */
  readonly VITE_BASE_PATH?: string
  /** Data provider key. Only 'mfapi' ships today. */
  readonly VITE_MF_PROVIDER?: string
  /** Overrides the NAV API endpoint. Must mirror MFapi.in's paths and response
   *  shape — e.g. a pass-through CORS proxy you control. */
  readonly VITE_MFAPI_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
