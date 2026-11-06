import type { DBAdapter } from 'better-auth/types'

export const DESKTOP_CLIENT_ID = 'heyday-desktop-beta'

/** Run only in the migration job, never in an unauthenticated HTTP endpoint. */
export async function seedDesktopClient(adapter: DBAdapter) {
  const existing = await adapter.findOne({ model: 'oauthClient', where: [{ field: 'clientId', value: DESKTOP_CLIENT_ID }] })
  // Preserve administrator revocations and edits on subsequent migrations.
  if (existing) return
  await adapter.create({ model: 'oauthClient', data: {
    clientId: DESKTOP_CLIENT_ID, name: 'Heyday Money Desktop Beta',
    applicationType: 'native', tokenEndpointAuthMethod: 'none',
    redirectUris: ['http://127.0.0.1/callback'],
    grantTypes: ['authorization_code', 'refresh_token'], responseTypes: ['code'],
    scopes: ['openid', 'email', 'offline_access'], requirePKCE: true,
    skipConsent: true, disabled: false, createdAt: new Date(), updatedAt: new Date(),
  } })
}
