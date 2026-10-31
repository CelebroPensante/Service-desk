import assert from 'node:assert/strict'
import { test } from 'node:test'
import { videoPoint, remoteKey } from '../src/components/chamados/remoteInput.ts'

test('maps contained video coordinates and rejects letterboxing', () => {
  const rect = { left: 100, top: 50, width: 1000, height: 1000 }
  assert.equal(videoPoint(200, 60, rect, 1920, 1080), null)
  assert.deepEqual(videoPoint(600, 550, rect, 1920, 1080), { x: 0.5, y: 0.5 })
  assert.equal(videoPoint(1101, 550, rect, 1920, 1080), null)
  assert.equal(videoPoint(600, 550, rect, 0, 0), null)
})
test('preserves physical keys across modifier changes and rejects unsupported keys', () => {
  assert.equal(remoteKey('KeyA', 'A'), 'a')
  assert.equal(remoteKey('Digit1', '!'), '1')
  assert.equal(remoteKey('ArrowLeft', 'ArrowLeft'), 'ArrowLeft')
  assert.equal(remoteKey('Unidentified', 'Dead'), null)
})
