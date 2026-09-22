import { Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { ArrowDownLeft, ArrowUpRight, Check, Moon, RefreshCw, Sun, X } from 'lucide-react'

import { translations, type Language } from '../i18n'
import { HouseWindows } from './HouseWindows'

const releasesUrl = 'https://github.com/heyday-money/heyday/releases'
const latestReleaseApi = 'https://api.github.com/repos/heyday-money/heyday/releases?per_page=1'

async function getMacDownloadUrl() {
  try {
    const response = await fetch(latestReleaseApi, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(10000),
    })
    if (!response.ok) return releasesUrl
    // The releases list includes published prereleases, unlike /releases/latest.
    const [release] = await response.json() as { assets: { name: string; browser_download_url: string }[] }[]
    if (!release) return releasesUrl
    const installers = release.assets.filter(asset => /\.dmg$/i.test(asset.name))
    const installer = installers.find(asset => /universal/i.test(asset.name))
      ?? (installers.length === 1 ? installers[0] : undefined)
    // Let visitors choose their Mac architecture when separate installers are published.
    return installer?.browser_download_url ?? releasesUrl
  } catch {
    return releasesUrl
  }
}

function Logo() {
  return <div className="group flex items-center gap-3 max-sm:gap-2 text-[22px] font-[750] tracking-[-1px] max-sm:text-[16px]" aria-label="Heyday.Money">
    <svg className="size-[43px] overflow-visible transition-transform duration-300 group-hover:-rotate-7 max-sm:size-[30px]" viewBox="0 0 1024 1024" aria-hidden="true">
      <rect className="fill-white transition-colors duration-500 dark:fill-[#212429]" width="1024" height="1024" rx="180" />
      <path className="animate-smile-in [stroke-dasharray:1] [stroke-dashoffset:0]" d="M761.427 421.742C761.427 663.861 613.288 812 371.169 812" stroke="#894EFE" strokeWidth="120.344" fill="none" pathLength="1" />
      <rect className="animate-eye-in" x="262" y="212" width="120.344" height="232.092" fill="#FED728" />
      <rect className="animate-eye-in [animation-delay:130ms]" x="478.619" y="212" width="120.344" height="232.092" fill="#FED728" />
    </svg>
    <span>heyday<span className="font-[450] text-muted">.money</span></span>
  </div>
}

function FeatureNote({ position, icon: Icon, tone, kicker, title }: {
  position: string
  icon: typeof ArrowUpRight
  tone: string
  kicker: string
  title: string
}) {
  return <div className={`absolute z-2 flex animate-appear items-center gap-3 rounded-xl border border-card-border bg-card p-3 shadow-[0_7px_30px_#30392a08] backdrop-blur-[14px] transition duration-300 hover:-translate-y-1 max-lg:gap-2 max-lg:p-2.5 max-sm:gap-1.5 max-sm:rounded-lg max-sm:p-2 ${position}`}>
    <span className={`grid size-[35px] shrink-0 place-items-center rounded-[10px] max-lg:size-7 max-sm:size-6 max-sm:rounded-md ${tone}`}><Icon className="size-5 max-sm:size-3.5" /></span>
    <div><span className="block text-[7px] font-semibold tracking-[1.35px] thai:tracking-normal thai:text-[10px] max-sm:thai:text-[8px] text-muted max-lg:text-[6px] max-sm:text-[5px] max-sm:tracking-[.7px]">{kicker}</span><strong className="mt-1 block text-xs font-[650] max-lg:text-[10px] max-sm:mt-0.5 max-sm:text-[8px] max-sm:thai:text-[10px]">{title}</strong></div>
  </div>
}

function PlatformIcon({ platform }: { platform: 'macOS' | 'Windows' }) {
  return platform === 'macOS' ? <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.1 12.7c0-2 1.7-3 1.8-3.1-1-1.5-2.5-1.7-3-1.7-1.3-.2-2.5.8-3.2.8-.7 0-1.7-.8-2.8-.8-1.5 0-2.9.9-3.7 2.2-1.5 2.6-.4 6.5 1.1 8.6.7 1 1.5 2.1 2.6 2 1 0 1.5-.6 2.8-.6s1.7.6 2.9.6 1.9-1 2.6-2c.8-1.2 1.1-2.3 1.1-2.4-.1 0-2.2-.8-2.2-3.6ZM15 6.5c.6-.8 1.1-1.9 1-3-.9 0-2 .6-2.7 1.4-.6.7-1.1 1.8-1 2.8 1 .1 2.1-.5 2.7-1.2Z" /></svg> : <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 4h8v8H3zm10 0h8v8h-8zM3 14h8v8H3zm10 0h8v8h-8z" /></svg>
}

export function Landing({ language }: { language: Language }) {
  const t = translations[language]
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [notice, setNotice] = useState(false)
  const [skyCycle, setSkyCycle] = useState(0)
  const [ready, setReady] = useState(false)
  const [downloadingMac, setDownloadingMac] = useState(false)
  const downloadMac = async () => {
    if (downloadingMac) return
    setDownloadingMac(true)
    try {
      window.location.assign(await getMacDownloadUrl())
    } finally {
      setDownloadingMac(false)
    }
  }
  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')
    setReady(true)
    const media = matchMedia('(prefers-color-scheme: dark)')
    const sync = () => {
      try { if (localStorage.getItem('heyday-theme')) return } catch { /* Storage can be unavailable. */ }
      const next = media.matches ? 'dark' : 'light'
      document.documentElement.dataset.theme = next
      setTheme(next)
      setSkyCycle(cycle => cycle + 1)
    }
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(false), 6500); return () => clearTimeout(timer) }, [notice])
  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light'
    setTheme(next)
    setSkyCycle(cycle => cycle + 1)
    document.documentElement.dataset.theme = next
    try { localStorage.setItem('heyday-theme', next) } catch { /* Theme still works without persistence. */ }
  }

  return <div className="page-shell relative grid h-svh min-h-[600px] grid-rows-[80px_minmax(0,1fr)_80px] overflow-hidden bg-page text-ink transition-colors duration-700 max-sm:min-h-[640px] max-sm:grid-rows-[68px_minmax(0,1fr)_68px]">
    <a className="absolute -top-16 left-5 z-20 rounded bg-ink p-2.5 text-page focus:top-2.5" href="#main">{t.skip}</a>
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true"><div className="absolute top-1/2 left-1/2 h-[710px] w-[1100px] -translate-1/2 bg-[radial-gradient(ellipse,#e9ecd995_0%,#eff0e54a_38%,transparent_69%)] dark:bg-[radial-gradient(ellipse,#8942fe24_0%,#65509310_48%,transparent_70%)]" />{Array.from({ length: 22 }, (_, i) => <i className="absolute size-0.5 rounded-full bg-white opacity-0 transition-opacity duration-1000 dark:animate-twinkle dark:opacity-35" key={i} style={{ left: `${(i * 43 + 7) % 100}%`, top: `${(i * 23 + 5) % 87}%`, animationDelay: `${i % 5}s` }} />)}</div>
    <header className="relative z-2 flex h-full items-center justify-between px-[4.4%] max-sm:px-4">
      <Logo />
      <div className="flex items-center gap-3 max-sm:gap-2"><span className="text-[11px] tracking-[.2px] text-muted max-lg:hidden">{t.perspective}</span>
        <button className="relative flex h-[39px] w-[78px] items-center justify-between gap-4 rounded-full border border-line bg-[#eaece5] px-2.5 dark:bg-[#16191d]" disabled={!ready} onClick={toggleTheme} aria-label={t.nightMode} role="switch" aria-checked={theme === 'dark'}><span className="absolute top-1 left-1 size-[29px] rounded-full bg-white shadow-sm transition-all duration-400 dark:translate-x-[38px] dark:bg-brand" /><Sun size={17} className="z-1 shrink-0 text-[#756534]" /><Moon size={17} className="z-1 shrink-0 text-[#888e88] dark:text-white" /></button></div>
    </header>

    <main id="main" className="main-content relative mx-auto grid h-full max-h-[850px] min-h-0 w-full self-center grid-rows-[auto_minmax(0,1fr)_auto]">
      <section className="relative z-1 flex animate-appear flex-col items-center px-6 pt-2 text-center max-sm:px-5" aria-labelledby="headline">
        <div className="mb-4 inline-flex items-center gap-2 text-[10px] font-semibold tracking-[2px] thai:tracking-normal thai:text-xs max-sm:thai:text-[10px] text-muted max-sm:mb-3 max-sm:text-[8px] max-sm:tracking-[1.4px] short:mb-2.5"><span className="size-1.5 rounded-full bg-brand" /> {t.kicker}</div>
        <h1 id="headline" className="thai:tracking-normal thai:leading-[1.35] thai:text-[clamp(30px,4vw,56px)] max-sm:thai:text-[clamp(28px,8vw,36px)] short:thai:text-[36px] max-sm:short:thai:text-[30px] relative inline-block text-[clamp(40px,4.5vw,67px)] leading-[1.1] font-[650] tracking-[-3.6px] max-lg:text-[49px] max-lg:tracking-[-2.8px] max-sm:text-[clamp(39px,10.6vw,56px)] max-sm:leading-[1.13] max-sm:tracking-[-2.3px] short:text-5xl max-sm:short:text-4xl">{t.headline}<br className="hidden max-sm:block" /> <span className="relative inline-block text-brand dark:text-[#b58bff]">{t.headlineAccent}
          <svg className="pointer-events-none absolute -top-[18px] -right-[28px] size-[.5em] fill-none stroke-[#d6b21d] stroke-[2.5] [stroke-linecap:round]" viewBox="0 0 36 36" aria-hidden="true">
            <path d="M6 16V6 M15.8995 20.1005L22.9706 13.0294 M20 30H30" />
          </svg>
        </span></h1>
        <p className="mx-auto mt-4 text-sm leading-[1.8] text-muted max-sm:max-w-[315px] max-sm:text-xs short:mt-2.5 short:text-[13px] max-sm:short:text-xs max-sm:short:leading-[1.6]">{t.intro}<br className="max-sm:hidden" /> {t.introNext}</p>
      </section>

      <section className="island-scene relative mx-auto h-full min-h-0 w-full max-w-[1000px] [container-type:size]" aria-label={t.islandLabel}>
        <div className="pointer-events-none absolute top-[24%] left-1/2 h-[60%] w-[74%] -translate-x-1/2 -rotate-12 rounded-[50%] border border-line opacity-65 max-lg:w-[90%]" aria-hidden="true" /><div className="pointer-events-none absolute top-[17%] left-1/2 h-[74%] w-[84%] -translate-x-1/2 -rotate-12 rounded-[50%] border border-line opacity-33 max-lg:w-full" aria-hidden="true" />
        <div className="celestial-orbit pointer-events-none absolute inset-y-0 inset-x-[3%]" key={skyCycle} data-transition={skyCycle > 0} aria-hidden="true">
          <div className="celestial-body day-sun absolute top-0 left-0 size-16 text-[#d7ad20] drop-shadow-[0_0_12px_#fed72865] max-sm:size-11"><Sun className="size-full" fill="currentColor" strokeWidth={2.5} /></div>
          <div className="celestial-body night-moon absolute top-0 left-0 size-16 text-accent drop-shadow-[0_0_16px_#fed72845] max-sm:size-11"><Moon className="size-full" fill="currentColor" /></div>
        </div>
        <div className="absolute top-[12%] left-[9%] h-[17px] w-[66px] rounded-full bg-white opacity-70 blur-[2px] transition-opacity duration-700 before:absolute before:-top-[13px] before:left-4 before:h-[26px] before:w-[31px] before:rounded-full before:bg-inherit dark:opacity-5 max-sm:-left-4" aria-hidden="true" /><div className="absolute top-[49%] right-[15%] h-[17px] w-[47px] rounded-full bg-white opacity-70 blur-[2px] transition-opacity duration-700 before:absolute before:-top-[13px] before:left-4 before:h-[26px] before:w-[31px] before:rounded-full before:bg-inherit dark:opacity-5 max-sm:right-0" aria-hidden="true" />
        <div className="absolute bottom-0.5 left-1/2 h-6 w-[310px] -translate-x-1/2 animate-shadow-breathe rounded-[50%] bg-[#53574916] blur-[13px] max-sm:w-[200px]" aria-hidden="true" />
        <div className="island-float absolute top-1/2 left-1/2 w-[min(66%,calc(150cqh-24px))] max-w-[700px] -translate-1/2 animate-float max-sm:w-[min(100%,calc(150cqh-24px))]"><img className="island-image relative z-1 block h-auto w-full transition-[filter] duration-1000 dark:brightness-[.78] dark:saturate-[.8] dark:drop-shadow-[0_0_35px_#8942fe20]" src="/images/island.png" alt={t.islandAlt} width="1536" height="1024" fetchPriority="high" /><HouseWindows /></div>
        <FeatureNote position="left-[4%] top-[30%] -rotate-4 max-sm:top-[23%]" icon={ArrowUpRight} tone="bg-brand/6 text-brand" kicker={t.cashKicker} title={t.cashTitle} />
        <FeatureNote position="right-[3%] top-[35%] rotate-4 max-sm:top-[30%]" icon={ArrowDownLeft} tone="bg-accent/15 text-[#a48712]" kicker={t.spendingKicker} title={t.spendingTitle} />
        <FeatureNote position="right-[3%] top-[70%] -rotate-3 max-sm:top-[75%]" icon={RefreshCw} tone="bg-[#7bad85]/10 text-[#679269]" kicker={t.subscriptionsKicker} title={t.subscriptionsTitle} />
        <span className="absolute bottom-[19%] left-[13%] text-[26px] text-[#ae93d4] max-sm:bottom-[8%] max-sm:text-xl" aria-hidden="true">✧</span><span className="absolute right-[16%] bottom-[10%] text-[15px] text-[#d5bc50] max-sm:right-[12%] max-sm:bottom-[5%]" aria-hidden="true">✦</span>
      </section>

      <section className="download-area relative z-2 animate-appear px-5 pt-2 pb-2 text-center [animation-delay:200ms]" aria-label={t.downloadLabel}>
        <p className="mb-4 text-[13px] font-[550] max-sm:mb-3 max-sm:text-xs short:mb-2.5">{t.freshStart}</p>
        <div className="flex flex-wrap justify-center gap-3 max-sm:gap-2">
          {(['macOS', 'Windows'] as const).map(platform => <button className={`flex min-w-48 items-center gap-3 rounded-xl border px-4 py-3 text-left transition duration-250 hover:-translate-y-0.5 hover:shadow-lg active:translate-y-0 max-sm:min-w-[155px] max-sm:gap-2 max-sm:px-3 short:py-2 [&>svg:first-child]:size-[27px] ${platform === 'macOS' ? 'border-transparent bg-brand text-white shadow-brand/10 shadow-md' : 'border-line bg-card text-ink'}`} key={platform} disabled={!ready || (platform === 'macOS' && downloadingMac)} aria-busy={platform === 'macOS' && downloadingMac} onClick={() => platform === 'macOS' ? void downloadMac() : setNotice(true)} aria-describedby="download-note"><PlatformIcon platform={platform} /><span><small className="block text-[9px] leading-[1.4] opacity-75">{platform === 'macOS' && downloadingMac ? t.preparing : t.downloadFor}</small><strong className="block text-base leading-[1.4] font-semibold max-sm:text-sm">{platform}</strong></span><ArrowUpRight className="ml-auto opacity-65 max-sm:size-3.5" size={18} /></button>)}
        </div>
        <p id="download-note" className="mt-3 flex items-center justify-center gap-1.5 text-[10px] text-muted short:mt-2"><span className="size-[5px] rounded-full bg-[#a5ad97]" /> {t.downloadNote}</p>
      </section>
    </main>

    <footer className="site-footer relative mx-[4.4%] flex h-full items-center justify-between gap-5 border-t border-line text-[10px] text-muted max-sm:flex-col max-sm:justify-center max-sm:gap-1">
      <span className="text-[10px] max-sm:text-[9px]">{t.footer} <strong className="font-[550] text-ink">{t.footerAccent}</strong></span>
      <span className="absolute left-1/2 flex -translate-x-1/2 items-baseline gap-2 whitespace-nowrap text-[10px] max-lg:hidden"><strong className="font-serif text-[15px] text-ink">heyday</strong> <span>/ˈheɪdeɪ/</span> <em>{t.definition}</em></span>
      <div className="flex shrink-0 items-center gap-4 max-sm:gap-3">
        <span className="text-[9px] max-sm:text-[8px]">© {new Date().getFullYear()} Heyday.Money</span>
        <nav aria-label={t.language} className="flex shrink-0 items-center rounded-full border border-line p-0.5 text-[10px] font-semibold">
          {(['en', 'th'] as const).map(locale => <Link key={locale} to={locale === 'en' ? '/' : '/th'} lang={locale} hrefLang={locale} aria-label={locale === 'en' ? 'English' : 'ไทย'} aria-current={language === locale ? 'page' : undefined} className={`grid h-6 w-7 place-items-center rounded-full transition-colors ${language === locale ? 'bg-brand/10 text-brand dark:text-[#b58bff]' : 'text-muted hover:text-ink'}`}>{locale.toUpperCase()}</Link>)}
        </nav>
      </div>
    </footer>
    <div className={`fixed bottom-6 left-1/2 z-10 flex w-max max-w-[calc(100%-32px)] -translate-x-1/2 items-center gap-3 rounded-xl bg-ink p-4 text-[13px] text-page shadow-xl transition duration-200 ${notice ? 'pointer-events-auto translate-y-0 opacity-100' : 'pointer-events-none translate-y-6 opacity-0'}`} role="status" aria-live="polite">{notice && <><Check size={19} className="shrink-0 text-[#b6d8a1]" /><span>{t.windowsNotice}</span><button className="grid place-items-center p-1" onClick={() => setNotice(false)} aria-label={t.dismiss}><X size={18} /></button></>}</div>
  </div>
}
