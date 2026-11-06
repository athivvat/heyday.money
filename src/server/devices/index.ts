import '@tanstack/react-start/server-only'
import { getAuth } from '../auth'
import { getPool } from '../db/pool'
import { deviceHandler } from './handler'
import { DeviceService } from './service'

export async function handleDevice(request: Request, action: 'me' | 'register' | 'list' | 'revoke' | 'keys' | 'enroll-key' | 'rotate-key', deviceId?: string) {
  return deviceHandler(new DeviceService(getPool()), input => getAuth().api.verifyDesktopAccess(input))(request, action, deviceId)
}
