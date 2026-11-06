import { Pool } from 'pg'
import { getMigrations } from 'better-auth/db/migration'
import { authConfig } from '../src/server/auth/config'
import { authOptions } from '../src/server/auth/options'
import { betterAuth } from 'better-auth'
import { seedDesktopClient } from '../src/server/auth/desktop-client'
import { migrateCloud } from '../src/server/db/migrate'

let pool: Pool | undefined
try {
  const config = authConfig(process.env)
  pool = new Pool({ connectionString: config.databaseUrl, max: 1, connectionTimeoutMillis: 5_000 })
  const options = authOptions(config, pool, async () => {
    throw new Error('Email is disabled during migrations.')
  })
  const migration = await getMigrations(options)
  if (process.argv.includes('--apply')) {
    await migration.runMigrations()
    await seedDesktopClient((await betterAuth(options).$context).adapter)
    await migrateCloud(pool, true)
    console.log('Authentication and cloud account/device/encryption/sync migrations applied.')
  } else {
    console.log(await migration.compileMigrations())
    console.log(await migrateCloud(pool, false))
  }
} catch {
  console.error('Authentication migration failed. Check configuration, database connectivity and schema permissions.')
  process.exitCode = 1
} finally {
  await pool?.end()
}
