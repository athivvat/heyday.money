import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import type { Pool } from 'pg'

/** Append-only migrations, applied once under a database-wide transaction lock. */
export async function migrateCloud(pool: Pool, apply: boolean) {
  const directory = new URL('../../../migrations/', import.meta.url)
  const files = (await readdir(directory)).filter(name => /^\d+_[a-z_]+\.sql$/.test(name)).sort()
  const migrations = await Promise.all(files.map(async name => {
    const sql = await readFile(new URL(name, directory), 'utf8')
    return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') }
  }))
  if (!apply) return migrations.map(m => `-- ${m.name}\n${m.sql}`).join('\n')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('heyday-cloud-migrations', 0))")
    await client.query('CREATE TABLE IF NOT EXISTS cloud_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())')
    for (const migration of migrations) {
      const { rows } = await client.query('SELECT checksum FROM cloud_migrations WHERE name = $1', [migration.name])
      if (rows.length) {
        if (rows[0].checksum !== migration.checksum) throw new Error('An applied migration was changed.')
        continue
      }
      await client.query(migration.sql)
      await client.query('INSERT INTO cloud_migrations (name, checksum) VALUES ($1, $2)', [migration.name, migration.checksum])
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
  return ''
}
