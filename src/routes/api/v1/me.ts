import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/v1/me')({
  server: { handlers: {
    GET: async ({ request }) => (await import('../../../server/devices')).handleDevice(request, 'me'),
  } },
})
