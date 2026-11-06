import { createFileRoute } from '@tanstack/react-router'
export const Route = createFileRoute('/api/billing/')({ server: { handlers: {
  GET: async ({ request }) => (await import('../../../server/billing')).handleBilling(request, 'summary'),
} } })
