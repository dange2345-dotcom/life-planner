import { useEffect, useRef, useState } from 'preact/hooks'

// Линия «% выполнения по дням» — одна серия, поэтому без легенды (название даёт заголовок карточки).
// Спеки: линия 2px, заливка ~10%, тонкая сплошная сетка, подписи — цветом текста; наведение/касание — подсказка.

export interface LinePoint {
  label: string
  /** Подпись в подсказке, например «5 окт». */
  title: string
  value: number | null
  detail?: string
}

const HEIGHT = 180
const PAD = { top: 12, right: 12, bottom: 24, left: 38 }

export function LineChart({ points, ariaLabel }: { points: LinePoint[]; ariaLabel: string }) {
  const [hover, setHover] = useState<number | null>(null)
  // Рисуем в реальную ширину контейнера, чтобы подписи были настоящего размера, а не сжатые viewBox'ом.
  const box = useRef<HTMLDivElement>(null)
  const [WIDTH, setWidth] = useState(640)
  useEffect(() => {
    const element = box.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.round(entry.contentRect.width))))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const innerW = WIDTH - PAD.left - PAD.right
  const innerH = HEIGHT - PAD.top - PAD.bottom
  const step = points.length > 1 ? innerW / (points.length - 1) : 0
  const x = (i: number) => PAD.left + (points.length > 1 ? i * step : innerW / 2)
  const y = (v: number) => PAD.top + innerH * (1 - v / 100)

  // Разрывы там, где плана не было (value = null).
  const segments: { i: number; v: number }[][] = []
  points.forEach((point, i) => {
    if (point.value === null) return
    const last = segments[segments.length - 1]
    if (last && last[last.length - 1].i === i - 1) last.push({ i, v: point.value })
    else segments.push([{ i, v: point.value }])
  })

  const lastIndex = points.reduce((acc, p, i) => (p.value !== null ? i : acc), -1)
  // Подписи дней не чаще, чем раз в ~36px.
  const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(1, Math.floor(innerW / 36))))

  function onMove(event: PointerEvent) {
    const svg = event.currentTarget as SVGSVGElement
    const rect = svg.getBoundingClientRect()
    const px = ((event.clientX - rect.left) / rect.width) * WIDTH
    const index = step ? Math.round((px - PAD.left) / step) : 0
    setHover(Math.max(0, Math.min(points.length - 1, index)))
  }

  const hovered = hover !== null ? points[hover] : null

  return (
    <div class="line-chart" ref={box}>
      <svg
        width={WIDTH}
        height={HEIGHT}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={ariaLabel}
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {[0, 50, 100].map((tick) => (
          <g key={tick}>
            <line class="line-chart__grid" x1={PAD.left} x2={WIDTH - PAD.right} y1={y(tick)} y2={y(tick)} />
            <text class="line-chart__tick" x={PAD.left - 8} y={y(tick) + 4} text-anchor="end">
              {tick}%
            </text>
          </g>
        ))}

        {points.map((point, i) =>
          i % labelEvery === 0 || i === points.length - 1 ? (
            <text key={i} class="line-chart__tick" x={x(i)} y={HEIGHT - 6} text-anchor="middle">
              {point.label}
            </text>
          ) : null,
        )}

        {segments.map((segment, k) => {
          const line = segment.map((p) => `${x(p.i)},${y(p.v)}`).join(' ')
          const area =
            segment.length > 1
              ? `M${x(segment[0].i)},${y(0)} L${line.split(' ').join(' L')} L${x(segment[segment.length - 1].i)},${y(0)} Z`
              : ''
          return (
            <g key={k}>
              {area && <path class="line-chart__area" d={area} />}
              <polyline class="line-chart__line" points={line} />
            </g>
          )
        })}

        {lastIndex >= 0 && hover === null && (
          <circle class="line-chart__dot" cx={x(lastIndex)} cy={y(points[lastIndex].value!)} r={4} />
        )}

        {hovered && hover !== null && (
          <g>
            <line class="line-chart__cross" x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} />
            {hovered.value !== null && <circle class="line-chart__dot" cx={x(hover)} cy={y(hovered.value)} r={5} />}
          </g>
        )}
      </svg>

      {hovered && hover !== null && (
        <div
          class="chart-tip"
          style={{ left: `${(x(hover) / WIDTH) * 100}%`, transform: `translateX(${hover > points.length / 2 ? '-100%' : '0'})` }}
        >
          <b>{hovered.title}</b>
          <span>{hovered.value === null ? 'нет плана' : `${hovered.value}%`}</span>
          {hovered.detail && <span class="muted">{hovered.detail}</span>}
        </div>
      )}
    </div>
  )
}
