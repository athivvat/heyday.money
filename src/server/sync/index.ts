import '@tanstack/react-start/server-only'
import { getAuth } from '../auth'
import { getPool } from '../db/pool'
import { DeviceService } from '../devices/service'
import { SyncService } from './service'
import { syncHandler } from './handler'

export function handleSync(request: Request, action: 'push' | 'pull' | 'snapshot') {
  return syncHandler(new SyncService(new DeviceService(getPool())), input => getAuth().api.verifyDesktopAccess(input))(request, action)
}
