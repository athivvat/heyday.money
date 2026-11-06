import '@tanstack/react-start/server-only'
import { Pool } from 'pg'

let pool: Pool | undefined
export function getPool() {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000 })
    pool.on('error', () => console.error('Database connection error.'))
  }
  return pool
}
