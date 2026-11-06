import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/v1/devices/')({
  server: { handlers: {
    GET: async ({ request }) => (await import('../../../../server/devices')).handleDevice(request, 'list'),
    POST: async ({ request }) => (await import('../../../../server/devices')).handleDevice(request, 'register'),
  } },
})
