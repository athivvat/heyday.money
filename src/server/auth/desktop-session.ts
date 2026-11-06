import type { BetterAuthOptions, Session } from 'better-auth'
import { APIError } from 'better-auth/api'
import type { VerificationValue } from '@better-auth/oauth-provider'
import { DESKTOP_CLIENT_ID } from './desktop-client'

/**
 * Give each native authorization its own session before the provider mints tokens.
 * Better Auth 1.7.15 stores authorization codes using its exported VerificationValue
 * format. Keep the real-provider login/refresh/logout tests when upgrading it.
 * Only the session reference changes: PKCE, scopes, nonce and authTime stay intact.
 */
export const desktopSessionHooks = {
  verification: {
    create: {
      before: async (verification, ctx) => {
        let grant: Partial<VerificationValue> | null
        try { grant = JSON.parse(verification.value) } catch { return }
        if (grant?.type !== 'authorization_code' || grant.query?.client_id !== DESKTOP_CLIENT_ID) return

        const authenticated = ctx?.context.session
        if (!ctx || !authenticated || typeof grant.sessionId !== 'string' || typeof grant.userId !== 'string' ||
            authenticated.session.id !== grant.sessionId || authenticated.user.id !== grant.userId || !authenticated.user.emailVerified) {
          throw new APIError('UNAUTHORIZED')
        }
        // Recheck persisted identity/expiry. Never recreate a deleted or expired login.
        const source = await ctx.context.adapter.findOne<Session>({
          model: 'session', where: [{ field: 'id', value: grant.sessionId }, { field: 'userId', value: grant.userId }],
        })
        if (!source || source.expiresAt.getTime() <= Date.now()) throw new APIError('UNAUTHORIZED')
        const desktop = await ctx.context.internalAdapter.createSession(grant.userId, false, {
          expiresAt: source.expiresAt, createdAt: source.createdAt,
          ipAddress: source.ipAddress, userAgent: source.userAgent,
        }, true)
        if (!desktop) throw new APIError('INTERNAL_SERVER_ERROR')
        // Its random session token stays server-side. The browser keeps its original
        // cookie; the app receives only OAuth tokens bound to this new session ID.
        return { data: { ...verification, value: JSON.stringify({ ...grant, sessionId: desktop.id }) } }
      },
    },
  },
} satisfies NonNullable<BetterAuthOptions['databaseHooks']>
