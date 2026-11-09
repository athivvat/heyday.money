import { createAuthEndpoint, APIError } from 'better-auth/api'
import { getOAuthProviderApi, type OAuthOptions } from '@better-auth/oauth-provider'
import { isNativeClient } from './desktop-client'

/** Server-only provider verification: no HTTP endpoint and no hand-decoded tokens. */
export function desktopAccess(options: OAuthOptions<string[]>) {
  return {
    id: 'heyday-desktop-access',
    endpoints: {
      verifyDesktopAccess: createAuthEndpoint.serverOnly({
        method: 'POST', metadata: { $Infer: { body: {} as { token: string } } },
      }, async ctx => {
        const token = ctx.body?.token
        if (typeof token !== 'string' || token.length > 8192 || !token) throw new APIError('UNAUTHORIZED')
        const claims = await getOAuthProviderApi(ctx, options).requireActiveAccessToken(token)
        // This first-party API accepts only our session-bound native client's opaque
        // access tokens. Resource-bound JWTs/ID tokens and DPoP are not supported here.
        if (token.includes('.') || !isNativeClient(claims.client_id) ||
            claims.iss !== ctx.context.baseURL || claims.aud !== undefined || claims.cnf ||
            typeof claims.sub !== 'string' || typeof claims.sid !== 'string' ||
            typeof claims.exp !== 'number' || claims.exp <= Date.now() / 1000 ||
            typeof claims.scope !== 'string' || !['openid', 'email'].every(s => (claims.scope as string).split(' ').includes(s))) {
          throw new APIError('UNAUTHORIZED')
        }
        return { userId: claims.sub, sessionId: claims.sid }
      }),
    },
  }
}
