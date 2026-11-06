import type { BetterAuthOptions } from 'better-auth'
import { emailOTP, jwt } from 'better-auth/plugins'
import { oauthProvider } from '@better-auth/oauth-provider'
import type { AuthConfig } from './config'
import { desktopAccess } from './desktop-access'
import { desktopSessionHooks } from './desktop-session'

export type SendCode = (input: { email: string; otp: string; type: string }) => Promise<void>

/** Shared by the production instance, migration runner and isolated integration tests. */
export function authOptions(config: AuthConfig, database: BetterAuthOptions['database'], sendCode: SendCode) {
  const providerOptions = {
    loginPage: '/login', consentPage: '/login',
    scopes: ['openid', 'email', 'offline_access'],
    grantTypes: ['authorization_code', 'refresh_token'] as ('authorization_code' | 'refresh_token')[],
    allowDynamicClientRegistration: false,
    allowUnauthenticatedClientRegistration: false,
    clientPrivileges: async () => false,
  }
  return {
    appName: 'Heyday Money',
    baseURL: config.url,
    secret: config.secret,
    database,
    trustedOrigins: [config.url],
    advanced: { disableOriginCheck: false, disableCSRFCheck: false },
    emailAndPassword: { enabled: false },
    // Beta deliberately exposes email-code login only, regardless of legacy env credentials.
    socialProviders: {},
    disabledPaths: ['/token'],
    account: { accountLinking: { enabled: true, disableImplicitLinking: true } },
    session: { cookieCache: { enabled: false } },
    databaseHooks: desktopSessionHooks,
    rateLimit: { enabled: true, storage: 'database', window: 60, max: 60 },
    // Raw library/provider errors can include sensitive request or database context.
    logger: { disabled: true },
    plugins: [jwt(), oauthProvider(providerOptions), desktopAccess(providerOptions), emailOTP({
      otpLength: 6, expiresIn: 300, allowedAttempts: 3, storeOTP: 'hashed',
      rateLimit: { window: 60, max: 3 },
      sendVerificationOTP: sendCode,
    })],
  } satisfies BetterAuthOptions
}
