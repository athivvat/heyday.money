import { isAPIError } from 'better-auth/api'
import { mutation } from '../../contracts/v1/sync'
import { apiResponse, ApiError, readJson } from '../api/http'
import type { DesktopIdentity } from '../devices/service'
import type { SyncService } from './service'

export function syncHandler(service: SyncService, verify: (input: { body: { token: string } }) => Promise<DesktopIdentity>) {
  return async (request: Request, action: 'push' | 'pull' | 'snapshot') => {
    const response = await apiResponse(async () => {
      const match = /^Bearer ([A-Za-z0-9._~-]+)$/i.exec(request.headers.get('authorization') ?? '')
      if (!match || match[1].length > 8192) throw new ApiError('AUTH_REQUIRED', 'A desktop access token is required.')
      let identity: DesktopIdentity
      try { identity = await verify({ body: { token: match[1] } }) }
      catch (error) {
        if (isAPIError(error) && error.statusCode < 500) throw new ApiError('AUTH_EXPIRED', 'Sign in again to continue.')
        throw error
      }
      const protocol = request.headers.get('X-Heyday-Sync') === '5' ? 5 : request.headers.get('X-Heyday-Sync') === '4' ? 4 : request.headers.get('X-Heyday-Sync') === '3' ? 3 : request.headers.get('X-Heyday-Sync') === '2' ? 2 : 1
      const keysVersion = request.headers.get('X-Heyday-Keys') === '2' ? 2 : 1
      return action === 'push' ? service.push(identity, mutation(await readJson(request, protocol >= 3 ? 3_145_728 : protocol === 2 ? 360_448 : 16_384)), protocol, keysVersion) : service.page(identity, new URL(request.url), protocol, keysVersion)
    })
    if (response.status === 401) response.headers.set('WWW-Authenticate', 'Bearer')
    if (response.status === 429) response.headers.set('Retry-After', '60')
    return response
  }
}
