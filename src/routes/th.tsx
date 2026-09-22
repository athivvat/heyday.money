import { createFileRoute } from '@tanstack/react-router'
import { Landing } from '../components/Landing'
import { languageHead } from '../i18n'

export const Route = createFileRoute('/th')({
  head: () => languageHead('th'),
  component: () => <Landing language="th" />,
})
