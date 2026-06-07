'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { markdownToHtml, markdownToText, normalise } = require('../src/render')

test('headings, bold and links render to HTML', () => {
  const html = markdownToHtml('# Title\n\nHello **world** and [link](https://example.com)')
  assert.match(html, /<h1[^>]*>Title<\/h1>/)
  assert.match(html, /<strong>world<\/strong>/)
  assert.match(html, /<a href="https:\/\/example\.com">link<\/a>/)
})

test('fenced code blocks render to pre/code', () => {
  const html = markdownToHtml('```\n{"a":1}\n```')
  assert.match(html, /<pre[^>]*><code>\{&quot;a&quot;:1\}<\/code><\/pre>/)
})

test('bullet lists render to ul/li', () => {
  const html = markdownToHtml('- one\n- two')
  assert.match(html, /<ul[^>]*><li>one<\/li><li>two<\/li><\/ul>/)
})

test('html in payload values is escaped, not executed', () => {
  const html = markdownToHtml('Value: <script>alert(1)</script>')
  assert.doesNotMatch(html, /<script>/)
  assert.match(html, /&lt;script&gt;/)
})

test('plain text strips markdown markers but keeps content and link target', () => {
  const text = markdownToText('# Title\n\n**bold** and [link](https://example.com)')
  assert.match(text, /Title/)
  assert.match(text, /bold/)
  assert.doesNotMatch(text, /\*\*/)
  assert.match(text, /link \(https:\/\/example\.com\)/)
})

test('normalise derives text and html from markdown', () => {
  const out = normalise({ subject: 'S', markdown: '# Hi\n\n**bold**' })
  assert.equal(out.subject, 'S')
  assert.match(out.html, /<h1/)
  assert.match(out.text, /Hi/)
  assert.equal(out.markdown, '# Hi\n\n**bold**')
})

test('normalise honours explicit text/html overrides', () => {
  const out = normalise({ subject: 'S', markdown: '# Hi', text: 'custom', html: '<b>x</b>' })
  assert.equal(out.text, 'custom')
  assert.equal(out.html, '<b>x</b>')
})

test('normalise rejects a result without a subject', () => {
  assert.equal(normalise(null), null)
  assert.equal(normalise({ markdown: 'x' }), null)
})

test('normalise passes a skip signal through', () => {
  assert.deepEqual(normalise({ skip: true }), { skip: true })
  // skip wins even when other fields are present
  assert.deepEqual(normalise({ skip: true, subject: 'S', markdown: '# Hi' }), { skip: true })
})
