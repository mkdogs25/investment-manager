/**
 * Provider registry — the single place that knows which providers exist.
 *
 * Adding another AMFI-derived source is a two-line change here plus a new
 * module in this folder; nothing else in the app needs to be touched.
 *
 * VITE_MFAPI_BASE_URL overrides the endpoint. That is the escape hatch if
 * MFapi.in ever stops allowing direct browser calls: point it at a pass-through
 * proxy you control that forwards the same /mf/... paths and adds permissive
 * CORS headers. It must mirror MFapi.in's URL shape and response format.
 */

import { MFApiProvider } from './mfapi'
import type { FundDataProvider } from './types'

const factories: Record<string, () => FundDataProvider> = {
  mfapi: () => new MFApiProvider(import.meta.env.VITE_MFAPI_BASE_URL),
}

const instances: Record<string, FundDataProvider> = {}

export function registerProvider(key: string, factory: () => FundDataProvider): void {
  factories[key] = factory
}

export function availableProviders(): string[] {
  return Object.keys(factories).sort()
}

export function getProvider(key?: string): FundDataProvider {
  const name = (key ?? import.meta.env.VITE_MF_PROVIDER ?? 'mfapi').toLowerCase()
  const factory = factories[name]
  if (!factory) {
    throw new Error(
      `Unknown data provider "${name}". Available: ${availableProviders().join(', ')}`,
    )
  }
  instances[name] ??= factory()
  return instances[name]
}

export function setProvider(key: string, provider: FundDataProvider): void {
  instances[key] = provider
}
