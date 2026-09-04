import { useEffect, useState } from 'react'
import { API_BASE, checkHealth } from '../services/api'
import { Callout } from './ui'

type State = 'checking' | 'online' | 'offline'

/**
 * The frontend can be hosted separately from the API (GitHub Pages, a CDN, an
 * S3 bucket). When it is, an unreachable or unconfigured backend would
 * otherwise surface only as an empty scheme search, so say so plainly instead.
 */
export function BackendNotice() {
  const [state, setState] = useState<State>('checking')

  useEffect(() => {
    const controller = new AbortController()
    checkHealth(controller.signal)
      .then(() => setState('online'))
      .catch(() => {
        if (!controller.signal.aborted) setState('offline')
      })
    return () => controller.abort()
  }, [])

  if (state !== 'offline') return null

  const isSameOrigin = API_BASE.startsWith('/')

  return (
    <Callout tone="warning" title="The analyzer backend is not reachable">
      <p>
        Scheme search and Excel report generation need the FastAPI backend, which
        performs all data retrieval and builds the workbook. This page is currently
        pointed at <code className="font-mono text-xs">{API_BASE}</code>.
      </p>
      <p className="mt-2">
        {isSameOrigin
          ? 'Start the backend locally (uvicorn app.main:app --port 8000), or rebuild this site with VITE_API_BASE_URL set to a hosted backend.'
          : 'Check that the backend is running at that address and that its MF_CORS_ORIGINS setting allows this site’s origin.'}
      </p>
    </Callout>
  )
}
