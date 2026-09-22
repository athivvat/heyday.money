import { useId } from 'react'

// Coordinates follow the original 1536 × 1024 illustration, so the windows
// stay registered with the house as the island scales and floats.
const windows = [
  { name: 'side', x: 535, y: 273, width: 61, height: 80, opening: '546,282 586,291 586,335 546,328', travel: 64 },
  { name: 'front', x: 670, y: 289, width: 55, height: 72, opening: '678,299 711,295 711,343 678,347', travel: 60 },
  { name: 'attic', x: 719, y: 177, width: 51, height: 65, opening: '730,186 758,183 758,229 730,230', travel: 55 },
]

export function HouseWindows() {
  const id = useId().replace(/:/g, '')
  return <svg className="house-windows pointer-events-none absolute inset-0 z-2 size-full transition-[filter] duration-1000 dark:brightness-[.78] dark:saturate-[.8]" viewBox="0 0 1536 1024" aria-hidden="true" focusable="false">
    <defs>
      {windows.map(window => <clipPath key={window.name} id={`${id}-${window.name}`}><polygon points={window.opening} /></clipPath>)}
    </defs>
    {windows.map(window => <g key={window.name}>
      <svg x={window.x} y={window.y} width={window.width} height={window.height} viewBox={`${window.x} ${window.y} ${window.width} ${window.height}`} overflow="hidden">
        <image href="/images/island-day-windows.png" width="1536" height="1024" />
      </svg>
      <g clipPath={`url(#${id}-${window.name})`}>
        <g className="house-window-sash" style={{ translate: `0 calc(var(--window-open) * -${window.travel}px)` }}>
          <g clipPath={`url(#${id}-${window.name})`}>
            <image href="/images/island.png" width="1536" height="1024" />
          </g>
        </g>
      </g>
    </g>)}
  </svg>
}
