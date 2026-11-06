import { createFileRoute } from '@tanstack/react-router'
export const Route = createFileRoute('/api/webhooks/billing')({ server: { handlers: {
  POST: async ({ request }) => (await import('../../../server/billing')).handleBillingWebhook(request),
} } })
