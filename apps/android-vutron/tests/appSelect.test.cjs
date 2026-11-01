const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path')

test('application Vue views use themed controls instead of native option pickers', () => {
  function check(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) check(file)
      else if (entry.name.endsWith('.vue')) assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /<select(?:\s|>)/i, file)
    }
  }
  check(path.resolve(__dirname, '../src'))
  check(path.resolve(__dirname, '../../../packages/ui/src'))
})
