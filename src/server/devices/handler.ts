import { isAPIError } from 'better-auth/api'
import { devicePageQuery, deviceRegistration, uuid } from '../../contracts/v1/devices'
import { apiResponse, ApiError, readJson } from '../api/http'
import type { DesktopIdentity, DeviceService } from './service'
import { keyEnvelope, keyRotation } from '../../contracts/v1/encryption'

type Verify = (input: { body: { token: string } }) => Promise<DesktopIdentity>
export function deviceHandler(service: DeviceService, verify: Verify) {
  return async (request: Request, action: 'me' | 'register' | 'list' | 'revoke' | 'keys' | 'enroll-key' | 'rotate-key', deviceId?: string) => {
    const response = await apiResponse(async () => {
      const header = request.headers.get('authorization') ?? ''
      const match = /^Bearer ([A-Za-z0-9._~-]+)$/i.exec(header)
      if (!match || match[1].length > 8192) throw new ApiError('AUTH_REQUIRED', 'A desktop access token is required.')
      let identity: DesktopIdentity
      try { identity = await verify({ body: { token: match[1] } }) }
      catch (error) {
        if (isAPIError(error) && error.statusCode < 500) throw new ApiError('AUTH_EXPIRED', 'Sign in again to continue.')
        throw error
      }
      if (action === 'me') return service.me(identity)
      if (action === 'keys') return service.keys(identity)
      if (action === 'rotate-key') return service.rotateKey(identity, keyRotation(await readJson(request, 196608)))
      if (action === 'enroll-key') return service.keys(identity, keyEnvelope(await readJson(request, 4096)))
      if (action === 'list') return service.list(identity, devicePageQuery(new URL(request.url)))
      if (action === 'register') return service.register(identity, deviceRegistration(await readJson(request, 2048)))
      return service.revoke(identity, uuid(deviceId, 'deviceId'))
    })
    if (response.status === 401) response.headers.set('WWW-Authenticate', 'Bearer')
    if (response.status === 429) response.headers.set('Retry-After', '60')
    return response
  }
}
