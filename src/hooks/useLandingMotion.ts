import { useEffect, useRef } from 'react'
import type { Language } from '../i18n'

export function useLandingMotion(language: Language) {
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const preference = matchMedia('(prefers-reduced-motion: reduce)')
    const elements = [...root.querySelectorAll<HTMLElement>('[data-reveal]')]
    const hero = root.querySelector<HTMLElement>('[data-hero-copy]')
    let observer: IntersectionObserver | undefined
    let frame = 0

    const updateHero = () => {
      frame = 0
      const progress = Math.min(Math.max(window.scrollY, 0) / Math.max(window.innerHeight * 0.45, 1), 1)
      hero?.style.setProperty('--hero-scroll', String(progress))
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(updateHero)
    }
    const stop = () => {
      observer?.disconnect()
      observer = undefined
      cancelAnimationFrame(frame)
      frame = 0
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      hero?.style.removeProperty('--hero-scroll')
    }
    const configure = () => {
      stop()
      if (!preference.matches && typeof IntersectionObserver === 'function') {
        observer = new IntersectionObserver(entries => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue
            const element = entry.target as HTMLElement
            element.dataset.revealState = 'visible'
            observer?.unobserve(entry.target)
          }
        }, { rootMargin: '0px 0px -24px 0px', threshold: 0 })
      }
      for (const element of elements) {
        // Enhance only below-the-fold content. SSR and restored scroll positions
        // stay readable, and a revealed element never hides again.
        if (!observer || element.dataset.revealState === 'visible' || element.getBoundingClientRect().top < window.innerHeight - 24) {
          element.dataset.revealState = 'visible'
        } else {
          element.dataset.revealState = 'pending'
          observer.observe(element)
        }
      }
      if (!preference.matches) {
        updateHero()
        window.addEventListener('scroll', onScroll, { passive: true })
        window.addEventListener('resize', onScroll)
      }
    }
    const onFocus = (event: FocusEvent) => {
      if (!(event.target instanceof Element)) return
      const element = event.target.closest<HTMLElement>('[data-reveal]')
      if (!element) return
      element.dataset.revealState = 'visible'
      observer?.unobserve(element)
    }

    configure()
    preference.addEventListener('change', configure)
    root.addEventListener('focusin', onFocus)
    return () => {
      stop()
      preference.removeEventListener('change', configure)
      root.removeEventListener('focusin', onFocus)
      elements.forEach(element => delete element.dataset.revealState)
    }
  }, [language])

  return rootRef
}
