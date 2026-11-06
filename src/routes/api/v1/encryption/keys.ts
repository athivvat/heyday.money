import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/v1/encryption/keys')({
  server: { handlers: {
    GET: async ({ request }) => (await import('../../../../server/devices')).handleDevice(request, 'keys'),
    PUT: async ({ request }) => (await import('../../../../server/devices')).handleDevice(request, 'enroll-key'),
    POST: async ({ request }) => (await import('../../../../server/devices')).handleDevice(request, 'rotate-key'),
  } },
})
