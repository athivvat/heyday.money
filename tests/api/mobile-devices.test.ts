import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deviceRegistration } from '../../src/contracts/v1/devices'

test('mobile registration expands only the reviewed platform allowlist', () => {
  const input = { installationId: '11111111-1111-4111-8111-111111111111', name: ' Phone ' }
  for (const platform of ['ios', 'android', 'macos', 'windows', 'linux']) {
    assert.deepEqual(deviceRegistration({ ...input, platform }), { ...input, name: 'Phone', platform })
  }
  for (const platform of ['web', 'iOS', '', null]) assert.throws(() => deviceRegistration({ ...input, platform }))
})
