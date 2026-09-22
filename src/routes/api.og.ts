import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/og')({
  server: {
    handlers: {
      GET: async () => {
        const { createOgImage } = await import('../server/og')
        return createOgImage()
      },
    },
  },
})
