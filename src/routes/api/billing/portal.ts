import { createFileRoute } from '@tanstack/react-router'
export const Route = createFileRoute('/api/billing/portal')({ server: { handlers: {
  POST: async ({ request }) => (await import('../../../server/billing')).handleBilling(request, 'portal'),
} } })
