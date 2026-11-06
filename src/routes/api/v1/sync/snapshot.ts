import { createFileRoute } from '@tanstack/react-router'
export const Route = createFileRoute('/api/v1/sync/snapshot')({ server: { handlers: {
  GET: async ({ request }) => (await import('../../../../server/sync')).handleSync(request, 'snapshot'),
} } })
