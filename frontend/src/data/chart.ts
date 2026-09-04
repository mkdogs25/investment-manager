/**
 * Renders the portfolio allocation as a doughnut chart PNG.
 *
 * ExcelJS cannot write native Excel charts, so the workbook embeds a rendered
 * image instead. The underlying numbers are always present as cells beside it,
 * so nothing is only expressed in the picture.
 *
 * Returns null when no canvas is available (e.g. under a non-DOM test runner);
 * callers simply omit the image in that case.
 */

export interface Slice {
  label: string
  value: number
  colour: string
}

export const ALLOCATION_COLOURS = [
  '#1e3a5f', '#0f766e', '#b45309', '#4c1d95', '#0369a1',
  '#9d174d', '#3f6212', '#7c2d12', '#155e75', '#581c87',
]

export function renderAllocationChart(
  slices: Slice[],
  width = 900,
  height = 420,
): ArrayBuffer | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  const scale = 2 // render at 2x so the image stays crisp in Excel
  canvas.width = width * scale
  canvas.height = height * scale
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.scale(scale, scale)

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)

  const total = slices.reduce((a, s) => a + s.value, 0)
  if (total <= 0) return null

  const cx = height / 2
  const cy = height / 2
  const outer = height * 0.38
  const inner = outer * 0.55

  let angle = -Math.PI / 2
  for (const slice of slices) {
    const sweep = (slice.value / total) * Math.PI * 2
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.arc(cx, cy, outer, angle, angle + sweep)
    ctx.closePath()
    ctx.fillStyle = slice.colour
    ctx.fill()
    angle += sweep
  }

  // Punch out the centre to make it a doughnut.
  ctx.globalCompositeOperation = 'destination-out'
  ctx.beginPath()
  ctx.arc(cx, cy, inner, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalCompositeOperation = 'source-over'

  // Legend. Labels are truncated by measured width, not character count, so a
  // long scheme name can never push its percentage off the canvas.
  const legendX = height + 16
  const textX = legendX + 18
  const available = width - textX - 12
  let legendY = 40
  ctx.font = '13px Calibri, sans-serif'
  ctx.textBaseline = 'middle'

  for (const slice of slices) {
    ctx.fillStyle = slice.colour
    ctx.fillRect(legendX, legendY - 6, 12, 12)
    ctx.fillStyle = '#1f2937'

    const suffix = ` — ${((slice.value / total) * 100).toFixed(2)}%`
    let name = slice.label
    if (ctx.measureText(name + suffix).width > available) {
      while (name.length > 1 && ctx.measureText(`${name}…${suffix}`).width > available) {
        name = name.slice(0, -1)
      }
      name = `${name}…`
    }
    ctx.fillText(name + suffix, textX, legendY)

    legendY += 22
    if (legendY > height - 20) break
  }

  const dataUrl = canvas.toDataURL('image/png')
  const binary = atob(dataUrl.split(',')[1])
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}
