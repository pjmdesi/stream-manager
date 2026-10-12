// Pins the agreed answers for every layout (APP-48). Run with `npm test`
// (Node's own runner; no test dependency). Excluded from the tsconfigs,
// which is why the import carries its extension for Node.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isStreamFolderName, streamFolderDate, streamFolderIndex, dateInName, recordingStart,
  relativeUnder, relativeKey, streamKeyOfFolder, streamKeyOfFile,
} from './streamKey.ts'

test('stream folder names', () => {
  assert.equal(isStreamFolderName('2026-10-15'), true)
  assert.equal(isStreamFolderName('2026-10-15-2'), true)
  assert.equal(isStreamFolderName('2026-10-15 18-25-17'), false)
  assert.equal(isStreamFolderName('clips'), false)
  assert.equal(isStreamFolderName('2026'), false)
  assert.equal(streamFolderDate('2026-10-15-3'), '2026-10-15')
  assert.equal(streamFolderIndex('2026-10-15'), 1)
  assert.equal(streamFolderIndex('2026-10-15-3'), 3)
})

test('dates and recording starts in file names', () => {
  assert.equal(dateInName('2026-10-15 18-25-17.mkv'), '2026-10-15')
  assert.equal(dateInName('SCP - Secret Laboratory 3_archive-av1.mkv'), null)
  assert.equal(dateInName('2026-10-15_sm-thumbnail.png'), '2026-10-15')
  const obs = recordingStart('2026-10-15 18-25-17.mkv')
  assert.deepEqual([obs?.getFullYear(), obs?.getMonth(), obs?.getDate(), obs?.getHours(), obs?.getMinutes(), obs?.getSeconds()], [2026, 9, 15, 18, 25, 17])
  assert.equal(recordingStart('2026-07-14_00-05.mkv')?.getHours(), 0)
  assert.equal(recordingStart('2026-10-15.mkv'), null)
})

test('relative paths are case-insensitive and keep the file casing', () => {
  assert.equal(relativeUnder('D:\\Streams', 'd:\\streams\\2026-10-15\\Clip.mkv'), '2026-10-15/Clip.mkv')
  assert.equal(relativeUnder('D:/Streams/', 'D:/Streams'), '')
  assert.equal(relativeUnder('D:\\Streams', 'D:\\StreamsOld\\x.mkv'), null)
  assert.equal(relativeUnder('', 'D:\\x.mkv'), null)
  assert.equal(relativeKey('D:\\Streams\\2026-10-15', 'D:\\Streams\\2026-10-15\\clips\\x.mkv'), 'clips/x.mkv')
  assert.equal(relativeKey('D:\\Streams\\2026-10-15', 'D:\\Streams\\2026-10-15\\x.mkv'), 'x.mkv')
  assert.equal(relativeKey('D:\\Streams\\2026-10-15', 'E:\\elsewhere\\x.mkv'), 'x.mkv')
})

test('stream key of a folder', () => {
  const root = 'D:\\Streams'
  assert.equal(streamKeyOfFolder(root, 'D:\\Streams\\2026-10-15'), '2026-10-15')
  assert.equal(streamKeyOfFolder(root, 'D:\\Streams\\2026\\10\\2026-10-15-2'), '2026/10/2026-10-15-2')
  // Dump mode: the folder is the root and the date is the key.
  assert.equal(streamKeyOfFolder(root, 'D:\\Streams\\', '2026-10-15'), '2026-10-15')
  // Without a date the root keys by its basename (the folder-mode callers never hit this).
  assert.equal(streamKeyOfFolder(root, root), 'Streams')
  // Outside the root or no root: basename.
  assert.equal(streamKeyOfFolder(root, 'E:\\other\\2026-10-15'), '2026-10-15')
  assert.equal(streamKeyOfFolder('', 'D:\\Streams\\2026-10-15'), '2026-10-15')
})

test('stream key of a file', () => {
  const root = 'D:\\Streams'
  assert.equal(streamKeyOfFile(root, 'D:\\Streams\\2026-10-15\\rec.mkv'), '2026-10-15')
  assert.equal(streamKeyOfFile(root, 'D:\\Streams\\2026-10-15\\clips\\c.mkv'), '2026-10-15')
  assert.equal(streamKeyOfFile(root, 'D:\\Streams\\2026\\10\\2026-10-15-2\\rec.mkv'), '2026/10/2026-10-15-2')
  // First stream folder wins, a date-named sub-folder inside it does not start a new stream.
  assert.equal(streamKeyOfFile(root, 'D:\\Streams\\2026-10-15\\2026-10-16\\x.mkv'), '2026-10-15')
  // Dump mode and root-level files: no owning folder.
  assert.equal(streamKeyOfFile(root, 'D:\\Streams\\2026-10-15 18-25-17.mkv'), null)
  // A date-named file at the root is not a folder.
  assert.equal(streamKeyOfFile(root, 'D:\\Streams\\2026-10-15'), null)
  assert.equal(streamKeyOfFile(root, 'E:\\other\\2026-10-15\\rec.mkv'), null)
})
