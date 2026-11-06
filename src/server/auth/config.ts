export interface AuthConfig {
  url: string
  secret: string
  databaseUrl: string
  resendApiKey: string
  emailFrom: string
}

export function authConfig(env: Record<string, string | undefined>): AuthConfig {
  const required = (name: string) => {
    const value = env[name]?.trim()
    if (!value) throw new Error(`Missing ${name}`)
    return value
  }
  const url = new URL(required('BETTER_AUTH_URL'))
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  const allowLocalHttp = env.NODE_ENV !== 'production' || env.AUTH_ALLOW_INSECURE_LOCALHOST === 'true'
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      (url.protocol !== 'https:' && !(local && url.protocol === 'http:' && allowLocalHttp))) {
    throw new Error('BETTER_AUTH_URL must be an HTTPS origin (HTTP localhost is allowed in development).')
  }
  const secret = required('BETTER_AUTH_SECRET')
  if (secret.length < 32) throw new Error('BETTER_AUTH_SECRET must contain at least 32 characters.')
  const databaseUrl = required('DATABASE_URL')
  if (!['postgres:', 'postgresql:'].includes(new URL(databaseUrl).protocol)) throw new Error('Expected a PostgreSQL DATABASE_URL.')
  return {
    url: url.origin, secret, databaseUrl,
    resendApiKey: required('RESEND_API_KEY'), emailFrom: required('AUTH_EMAIL_FROM'),
  }
}
