import { createFileRoute } from '@tanstack/react-router'
export const Route = createFileRoute('/api/v1/sync/push')({ server: { handlers: {
  POST: async ({ request }) => (await import('../../../../server/sync')).handleSync(request, 'push'),
} } })
