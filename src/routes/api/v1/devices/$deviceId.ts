import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/v1/devices/$deviceId')({
  server: { handlers: {
    DELETE: async ({ request, params }) => (await import('../../../../server/devices')).handleDevice(request, 'revoke', params.deviceId),
  } },
})
