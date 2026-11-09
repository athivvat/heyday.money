import type { DBAdapter } from 'better-auth/types'

export const DESKTOP_CLIENT_ID = 'heyday-desktop-beta'
export const MOBILE_CLIENT_ID = 'heyday-mobile-beta'
export const NATIVE_CLIENT_IDS = [DESKTOP_CLIENT_ID, MOBILE_CLIENT_ID] as const
export function isNativeClient(id: unknown): boolean { return typeof id === 'string' && NATIVE_CLIENT_IDS.some(client => client === id) }

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

/** Separate public native client: exact mobile callback, no loopback exception. */
export async function seedMobileClient(adapter: DBAdapter) {
  const existing = await adapter.findOne({ model: 'oauthClient', where: [{ field: 'clientId', value: MOBILE_CLIENT_ID }] })
  if (existing) return
  await adapter.create({ model: 'oauthClient', data: {
    clientId: MOBILE_CLIENT_ID, name: 'Heyday Money Mobile Beta',
    applicationType: 'native', tokenEndpointAuthMethod: 'none',
    redirectUris: ['money.heyday.mobile:/oauth/callback'],
    grantTypes: ['authorization_code', 'refresh_token'], responseTypes: ['code'],
    scopes: ['openid', 'email', 'offline_access'], requirePKCE: true,
    skipConsent: true, disabled: false, createdAt: new Date(), updatedAt: new Date(),
  } })
}
