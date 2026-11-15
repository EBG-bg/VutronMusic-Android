import test from 'node:test'
import assert from 'node:assert/strict'
import { artworkPixelEdge, artworkRequestUrl, artworkUrl } from '../src/artwork.ts'

test('selects the available cover field', () => {
  assert.equal(artworkUrl({ al: { picUrl: 'https://p1.music.126.net/cover.jpg' } }), 'https://p1.music.126.net/cover.jpg')
})

test('requests 512 square artwork from NetEase image hosts', () => {
  const result = new URL(artworkRequestUrl('http://p1.music.126.net/cover.jpg?param=100y100'))
  assert.equal(result.protocol, 'https:')
  assert.equal(result.searchParams.get('param'), '512y512')
})

test('preserves non-NetEase artwork URLs', () => {
  const source = 'http://images.example.com/cover.jpg?size=small'
  assert.equal(artworkRequestUrl(source), source)
})
test('chooses bounded display-density tiers while keeping the player maximum', () => {
  assert.equal(artworkPixelEdge(44, 1), 96)
  assert.equal(artworkPixelEdge(48, 3), 192)
  assert.equal(artworkPixelEdge(100, 3), 320)
  assert.equal(artworkPixelEdge(180, 3), 512)
  assert.equal(artworkPixelEdge(340, 3), 512)
  assert.equal(artworkPixelEdge(NaN, NaN), 192)
})
test('resizes only the trusted image CDN and retains signed query values', () => {
  const url = new URL(artworkRequestUrl('http://p1.music.126.net/cover.jpg?param=512y512&token=opaque#cover', 192))
  assert.equal(url.searchParams.get('param'), '192y192')
  assert.equal(url.searchParams.get('token'), 'opaque')
  assert.equal(url.hash, '#cover')
  assert.equal(new URL(artworkRequestUrl(url.href, 9999)).searchParams.get('param'), '512y512')
  const signed = 'https://server.example/cover?signature=opaque&param=original'
  assert.equal(artworkRequestUrl(signed, 96), signed)
})
