# Development

Run `bun install`, then `bun run dev` and open http://localhost:3000.

`bun run build` builds the TanStack Start app. `bun run typecheck` checks TypeScript. `bun run preview` previews the production build.

With Google Chrome installed and the development server running, `bunx playwright test --workers=1` verifies theme persistence, system preference, download notifications, mobile overflow, and reduced motion. Screenshots are saved in `test-results/`.

The page uses TanStack Start, React, Tailwind CSS v4, and Bun. Framework setup follows the [TanStack Start documentation](https://tanstack.com/start/latest/docs/framework/react/build-from-scratch).

Layout, responsive rules, typography, colors, and component styling use Tailwind utilities in `src/routes/index.tsx`. `src/styles.css` contains the Tailwind theme tokens, base defaults, and animation keyframes/motion paths. The `dark:` variant follows `data-theme`; the `short:` variant adjusts layouts below 740px viewport height. Shared feature cards use the `FeatureNote` component.

The day/night switch follows the system preference until the visitor chooses a mode, then saves that choice locally. Animations respect reduced-motion preferences.

The macOS and Windows buttons currently show a coming-soon notification. Replace the button handlers in `src/routes/index.tsx` with the actual installer destinations when releases are ready.
