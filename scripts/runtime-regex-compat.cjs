'use strict';
// Build-time only. Node on Android was compiled without ICU; preserve Unicode
// semantics using the locked complete property tables instead of ASCII fallbacks.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const ts = require(path.join(root, 'apps/android-vutron/node_modules/typescript'));
const rewritePattern = require(path.join(root, 'packages/plugin-api/node_modules/regexpu-core'));
const toolVersion = require(path.join(root, 'packages/plugin-api/node_modules/regexpu-core/package.json')).version;
const unicodeVersion = require(path.join(root, 'packages/plugin-api/node_modules/regenerate-unicode-properties/unicode-version.js'));
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const property = /\\[pP]\{/;

function transform(source, fileName = 'runtime.js') {
  if (!/\.[cm]?js$/.test(fileName) || !source.includes('\\p{') && !source.includes('\\P{') && !/\/[dgimsuy]*v[dgimsuvy]*(?:[\s;,.)]|$)/.test(source)) return { code: source, changes: [] };
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const bindings = new Map();
  const scope = node => {
    while (node && !ts.isSourceFile(node) && !ts.isBlock(node) && !ts.isFunctionLike(node) && !ts.isModuleBlock(node)) node = node.parent;
    return node || file;
  };
  function bind(owner, name, initializer) {
    let entries = bindings.get(owner);
    if (!entries) { entries = new Map(); bindings.set(owner, entries); }
    entries.set(name, entries.has(name) ? null : initializer);
  }
  function functionScope(node) {
    while (node && !ts.isSourceFile(node) && !ts.isFunctionLike(node)) node = node.parent;
    return node || file;
  }
  function collect(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      // Ambiguous or mutable declarations are deliberately not constant-folded.
      const list = node.parent;
      const owner = list.flags & ts.NodeFlags.BlockScoped ? scope(node.parent) : functionScope(node.parent);
      bind(owner, node.name.text, list.flags & ts.NodeFlags.Const ? node.initializer : null);
    } else if (ts.isParameter(node) && ts.isIdentifier(node.name)) {
      bind(node.parent, node.name.text, null);
    } else if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) {
      bind(scope(node.parent), node.name.text, null);
    }
    ts.forEachChild(node, collect);
  }
  collect(file);
  function binding(node, name) {
    let owner = scope(node.parent);
    while (owner) {
      const entries = bindings.get(owner);
      if (entries?.has(name)) return { found:true, initial:entries.get(name) };
      owner = owner.parent ? scope(owner.parent) : null;
    }
    return { found:false };
  }
  function constant(node, seen = new Set()) {
    if (!node) return undefined;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isParenthesizedExpression(node)) return constant(node.expression, seen);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = constant(node.left, seen), right = constant(node.right, seen);
      return typeof left === 'string' && typeof right === 'string' ? left + right : undefined;
    }
    if (ts.isTemplateExpression(node)) {
      let value = node.head.text;
      for (const part of node.templateSpans) { const item = constant(part.expression, seen); if (typeof item !== 'string') return undefined; value += item + part.literal.text; }
      return value;
    }
    if (ts.isIdentifier(node)) {
      const { initial } = binding(node, node.text);
      if (!initial || seen.has(initial)) return undefined;
      const next = new Set(seen); next.add(initial); return constant(initial, next);
    }
    return undefined;
  }
  const edits = [], changes = [];
  function rewrite(node, pattern, flags, kind) {
    if (!flags.includes('v') && (!flags.includes('u') || !property.test(pattern))) return;
    let outputFlags = flags;
    const output = rewritePattern(pattern, flags, { unicodePropertyEscapes: 'transform', unicodeSetsFlag: 'transform', onNewFlags(value) { outputFlags = value; } });
    if (property.test(output) || outputFlags.includes('v')) throw new Error('Unicode compatibility conversion incomplete: ' + fileName);
    const regex = new RegExp(output, outputFlags);
    edits.push({ start: node.getStart(file), end: node.end, value: '/' + regex.source + '/' + outputFlags });
    changes.push({ kind, line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1, pattern, flags, outputFlags, outputSha256: digest(regex.source) });
  }
  function visit(node) {
    if (ts.isRegularExpressionLiteral(node)) {
      const text = node.getText(file), slash = text.lastIndexOf('/');
      rewrite(node, text.slice(1, slash), text.slice(slash + 1), 'literal');
    } else if ((ts.isNewExpression(node) || ts.isCallExpression(node)) && ts.isIdentifier(node.expression) && node.expression.text === 'RegExp' && node.arguments && !binding(node.expression, 'RegExp').found) {
      const pattern = constant(node.arguments[0]), flags = node.arguments.length > 1 ? constant(node.arguments[1]) : '';
      if (typeof pattern === 'string' && typeof flags === 'string') rewrite(node, pattern, flags, 'constructor');
      else if (typeof pattern === 'string' && property.test(pattern)) throw new Error('Dynamic Unicode RegExp flags need an explicit compatibility adapter: ' + fileName);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  let code = source;
  for (const edit of edits.sort((a,b) => b.start-a.start)) code = code.slice(0,edit.start) + edit.value + code.slice(edit.end);
  return { code, changes };
}

function record(files, relative, original, result) {
  if (result.changes.length) files.push({ file: relative.replaceAll('\\','/'), sourceSha256: digest(original), outputSha256: digest(result.code), expressions: result.changes });
}
function manifest(target, name, files, check) {
  const value = JSON.stringify({ format: 1, generator: 'scripts/runtime-regex-compat.cjs', regexpuCore: toolVersion, unicodeVersion,
    files: files.sort((a,b)=>a.file.localeCompare(b.file, 'en')) }, null, 2) + '\n';
  const output = path.join(target, 'runtime-compat-' + name + '.json');
  if (check) { if (!fs.existsSync(output) || fs.readFileSync(output,'utf8') !== value) throw new Error('Runtime compatibility manifest differs: ' + output); }
  else fs.writeFileSync(output, value);
}
module.exports = { transform, record, manifest, toolVersion, unicodeVersion };

if (require.main === module) {
  const assets = path.join(root, 'vendor/android-runtime/src/main/assets/sources-runtime');
  let files = 0;
  function verify(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) verify(file);
      else if (entry.isFile() && /\.[cm]?js$/.test(entry.name)) {
        const original = fs.readFileSync(file, 'utf8'), result = transform(original, file); files++;
        if (result.changes.length) throw new Error('Unconverted Unicode runtime expression: ' + path.relative(assets,file));
      }
    }
  }
  verify(assets);
  for (const group of ['contracts', 'dependencies']) {
    const input = JSON.parse(fs.readFileSync(path.join(assets, 'runtime-compat-' + group + '.json'), 'utf8'));
    if (input.regexpuCore !== toolVersion || input.unicodeVersion !== unicodeVersion) throw new Error('Stale runtime Unicode compatibility toolchain: ' + group);
    for (const file of input.files) if (digest(fs.readFileSync(path.join(assets,file.file))) !== file.outputSha256) throw new Error('Runtime compatibility output hash differs: ' + file.file);
  }
  console.log(JSON.stringify({ checkedJavaScriptFiles:files, regexpuCore:toolVersion, unicodeVersion, activeUnsupportedExpressions:0 }));
}
