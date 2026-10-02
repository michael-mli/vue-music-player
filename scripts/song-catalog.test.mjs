import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import ts from 'typescript'

const source = await fs.readFile(new URL('../src/services/songService.ts', import.meta.url), 'utf8')
let compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
compiled = compiled.replace("import api from './api';", 'const api = {};')
  .replace("import { getLyricsUrl } from '@/config';", "const getLyricsUrl = id => '/lyrics/'+id;")
const { songService } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
test('empty authoritative catalog returns no songs without fallback catalog requests', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original })
  const paths = []
  globalThis.fetch = async url => { paths.push(new URL(url, 'http://fixture').pathname); return new Response('0\n') }
  const result = await songService.getMockSongs()
  assert.deepEqual(result.data, [])
  assert.deepEqual(paths, ['/data/song_number.txt'])
})
test('empty fallback catalog is valid when the primary path is unavailable', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original })
  const paths = []
  globalThis.fetch = async url => {
    const path = new URL(url, 'http://fixture').pathname; paths.push(path)
    return new Response(path === '/song_number.txt' ? '0' : 'missing', { status: path === '/song_number.txt' ? 200 : 404 })
  }
  assert.equal(await songService.getMaxSongNumber(), 0)
  assert.deepEqual(paths, ['/data/song_number.txt', '/song_number.txt'])
})
