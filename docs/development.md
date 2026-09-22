# Development

Run `bun install`, then `bun run dev` and open http://localhost:3000.

`bun run build` builds the TanStack Start app. `bun run typecheck` checks TypeScript. `bun run preview` previews the production build.

With Google Chrome installed and the development server running, `bunx playwright test --workers=1` verifies theme persistence, system preference, download notifications, mobile overflow, and reduced motion. Screenshots are saved in `test-results/`.

The page uses TanStack Start, React, Tailwind CSS v4, and Bun. Framework setup follows the [TanStack Start documentation](https://tanstack.com/start/latest/docs/framework/react/build-from-scratch).

Layout, responsive rules, typography, colors, and component styling use Tailwind utilities in `src/components/Landing.tsx`. `src/styles.css` contains the Tailwind theme tokens, base defaults, and animation keyframes/motion paths. The `dark:` variant follows `data-theme`; the `short:` variant adjusts layouts below 740px viewport height. Shared feature cards use the `FeatureNote` component.

The day/night switch follows the system preference until the visitor chooses a mode, then saves that choice locally. Animations respect reduced-motion preferences.

The macOS button fetches the newest published release, including prereleases, from `https://api.github.com/repos/heyday-money/heyday/releases?per_page=1` when clicked and downloads its DMG (preferring a universal installer). If separate architecture installers are available, no DMG is present, or the request fails or exceeds 10 seconds, it opens the releases page. Windows still shows a coming-soon notification. No GitHub token is required; the repository and releases must be public for the API lookup to succeed.

## Vercel deployment

The Nitro Vite plugin is configured between TanStack Start and React, following [Vercel's TanStack Start guide](https://vercel.com/docs/frameworks/full-stack/tanstack-start). Nitro automatically selects the Vercel preset on Vercel.

Import this repository into Vercel and select the directory containing `package.json` as the project root. Use `bun install --frozen-lockfile` for installation and `bun run build` for the build command. Leave the output directory at the framework default; do not override it to `dist`.

To verify Vercel output locally without deploying, run `NITRO_PRESET=vercel bun run build`. This generates `.vercel/output/` with static assets and the server function. A normal local `bun run build` generates `.output/` for `bun run preview`.

## Languages

English is served at `/` (no `/en` prefix), and Thai at `/th`. The EN/TH links in the footer switch routes; the chosen language stays in the URL on reload and can be shared. Page copy is in `src/i18n.ts`, with localized titles, descriptions, accessibility labels, and document language. Both routes use `src/components/Landing.tsx`.

## House windows

`HouseWindows.tsx` overlays three registered window regions on the original island. The lit sashes slide up for open, unlit daytime windows and down at night; reduced-motion settings make the change immediate. The generated daytime layer is in `public/images/island-day-windows.png`; only its window regions are rendered, preserving the original island and transparency. Created with the built-in imagegen tool using this prompt: “Preserve the original 1536×1024 island and window alignment. Change only the three windows to open vertical sash windows with raised lower sashes, pale blue upper glass, dark unlit interiors, and original wooden frames. No yellow light; preserve all other geometry.”

## Social preview

`/api/og` generates a 1200 × 630 PNG using `@vercel/og` and a PNG copy (`src/heyday-money.png`) of the supplied `src/heyday-money.webp`. The PNG conversion is needed by this renderer; the original WebP is preserved. The original card is embedded in the server bundle, so generation needs no external image fetch or font download. Replace the PNG copy to update the preview. On macOS, regenerate it with `sips -s format png src/heyday-money.webp --out src/heyday-money.png`. Responses cache for one hour in browsers and one day on the CDN.

Both `/` and `/th` include server-rendered Open Graph and Twitter large-image tags with localized titles/descriptions, canonical URLs, and the shared preview. The production origin is `https://heyday.money` in `languageHead` in `src/i18n.ts`. Preview the image at `http://127.0.0.1:3000/api/og`. `@vercel/og` is pinned to 0.8.5 because 1.0.2 ships without the required `hb.wasm` asset. Implementation follows [Vercel’s OG image generation guide](https://vercel.com/docs/og-image-generation).
