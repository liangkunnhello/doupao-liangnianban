import { useEffect, useState } from 'react'
import { useMediaQuery } from '../hooks/useMediaQuery'

const MAX_MARKERS = 7

type PageMetrics = {
  activeMarker: number
  markerCount: number
  max: number
  pageCount: number
}

function getPageMetrics(): PageMetrics {
  const root = document.documentElement
  const max = Math.max(0, root.scrollHeight - window.innerHeight)
  const pageCount = Math.ceil(max / window.innerHeight) + 1
  const markerCount = max >= window.innerHeight * 0.25
    ? Math.min(pageCount, MAX_MARKERS)
    : 0
  const progress = max ? window.scrollY / max : 0

  return {
    activeMarker: markerCount > 1 ? Math.round(progress * (markerCount - 1)) : 0,
    markerCount,
    max,
    pageCount,
  }
}

export default function AppPageRail({ enabled }: { enabled: boolean }) {
  const desktopPointer = useMediaQuery('(min-width: 1024px) and (pointer: fine)')
  const [metrics, setMetrics] = useState<PageMetrics>({ activeMarker: 0, markerCount: 0, max: 0, pageCount: 1 })

  useEffect(() => {
    if (!enabled || !desktopPointer) return

    const update = () => setMetrics(getPageMetrics())
    const observer = new ResizeObserver(update)
    observer.observe(document.documentElement)
    observer.observe(document.body)
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    update()

    return () => {
      observer.disconnect()
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [desktopPointer, enabled])

  useEffect(() => {
    const root = document.documentElement
    if (!enabled || !desktopPointer) return
    root.classList.add('app-page-rail-active')
    return () => root.classList.remove('app-page-rail-active')
  }, [desktopPointer, enabled])

  if (!enabled || !desktopPointer || metrics.markerCount < 2) return null

  return (
    <nav aria-label="页面翻页" className="app-page-rail">
      {Array.from({ length: metrics.markerCount }, (_, index) => {
        const target = metrics.markerCount === 1
          ? 0
          : Math.round(metrics.max * index / (metrics.markerCount - 1))
        const page = Math.min(metrics.pageCount, Math.round(target / window.innerHeight) + 1)
        const isActive = index === metrics.activeMarker

        return (
          <button
            aria-current={isActive ? 'page' : undefined}
            aria-label={`跳到第 ${page} 页，共 ${metrics.pageCount} 页`}
            className="app-page-rail__marker"
            data-active={isActive || undefined}
            key={target}
            onClick={() => window.scrollTo({ behavior: 'auto', top: target })}
            type="button"
          />
        )
      })}
    </nav>
  )
}
