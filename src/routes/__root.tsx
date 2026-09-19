import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router'
import stylesheet from '../styles.css?url'

const themeScript = `try{const t=localStorage.getItem('heyday-theme');document.documentElement.dataset.theme=t==='dark'||t==='light'?t:matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}catch{document.documentElement.dataset.theme=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}`

export const Route = createRootRoute({
  head: () => ({
    meta: [{ charSet: 'utf-8' }, { name: 'viewport', content: 'width=device-width, initial-scale=1' }, { title: 'Heyday.Money — Your money, Your Heyday!' }, { name: 'description', content: 'Take back control of your finances. A clear picture of your cash flow, spending, and subscriptions, with Heyday.Money for macOS and Windows.' }, { name: 'theme-color', content: '#8942fe' }],
    links: [{ rel: 'stylesheet', href: stylesheet }, { rel: 'icon', type: 'image/svg+xml', href: '/logo-dark.svg' }],
  }),
  component: () => <html lang="en" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: themeScript }} /><HeadContent /></head><body><Outlet /><Scripts /></body></html>,
})
