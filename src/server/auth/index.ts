import '@tanstack/react-start/server-only'
import { betterAuth } from 'better-auth'
import { getPool } from '../db/pool'
import { Resend } from 'resend'
import { authConfig } from './config'
import { authOptions } from './options'
import { sendAuthCode } from './email'

function createAuth() {
  const config = authConfig(process.env)
  return betterAuth(authOptions(config, getPool(), sendAuthCode(new Resend(config.resendApiKey), config.emailFrom)))
}

let instance: ReturnType<typeof createAuth> | undefined
export function getAuth() { return instance ??= createAuth() }
