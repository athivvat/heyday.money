import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: async ({ request }) => (await import('../../../server/auth/handler')).handleAuth(request),
      POST: async ({ request }) => (await import('../../../server/auth/handler')).handleAuth(request),
    },
  },
})
