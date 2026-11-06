import { createFileRoute } from '@tanstack/react-router'
export const Route = createFileRoute('/api/billing/checkout')({ server: { handlers: {
  POST: async ({ request }) => (await import('../../../server/billing')).handleBilling(request, 'checkout'),
} } })
