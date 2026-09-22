import { createRootRoute, HeadContent, Outlet, Scripts, useRouterState } from '@tanstack/react-router'
import { Analytics } from '@vercel/analytics/react'
import stylesheet from '../styles.css?url'

const themeScript = `try{const t=localStorage.getItem('heyday-theme');document.documentElement.dataset.theme=t==='dark'||t==='light'?t:matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}catch{document.documentElement.dataset.theme=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}`

export const Route = createRootRoute({
  head: () => ({
    meta: [{ charSet: 'utf-8' }, { name: 'viewport', content: 'width=device-width, initial-scale=1' }, { title: 'Heyday.Money — Your money, Your Heyday!' }, { name: 'description', content: 'Take back control of your finances. A clear picture of your cash flow, spending, and subscriptions, with Heyday.Money for macOS and Windows.' }, { name: 'theme-color', content: '#8942fe' }],
    links: [
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
      { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Inter:wght@100..900&family=Noto+Sans+Thai:wght@100..900&display=swap' },
      { rel: 'stylesheet', href: stylesheet },
      { rel: 'icon', type: 'image/svg+xml', href: '/logo-dark.svg' },
    ],
  }),
  component: RootDocument,
})

function RootDocument() {
  const pathname = useRouterState({ select: state => state.location.pathname })
  return <html lang={pathname === '/th' || pathname === '/th/' ? 'th' : 'en'} suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: themeScript }} /><HeadContent /></head><body><Outlet /><Analytics /><Scripts /></body></html>
}
