// The pure half of host-target support: build a config, check its shape, render a
// snippet. No file is opened here and no argument is parsed here, so the test
// suite can import this module and exercise every emitter without a filesystem,
// without a bMS and without a host application installed.
//
// The shapes are not invented in this file. lib\hosts.json carries them as data,
// read out of each host's own current documentation with the URL and the
// deliberately-unmade claims recorded alongside. This file is the machinery;
// that file is the knowledge. Adding a host should be a JSON entry.
//
// Claude Desktop is NOT emitted here -- it keeps lib\merge-config.mjs. That path
// is verified, it is what this estate runs on today, and the whole point of this
// work is to add targets without disturbing it.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

export function loadRegistry(path) {
  const raw = readFileSync(path || resolve(HERE, 'hosts.json'), 'utf8').replace(/^﻿/, '');
  const reg = JSON.parse(raw);
  reg.byId = new Map(reg.targets.map((t) => [t.id, t]));
  return reg;
}

export const domainOf = (name) => String(name).replace(/^bconnect-/, '');

// ─── Entry construction ──────────────────────────────────────────────────────
// One function builds every per-server object for every host. A host differs from
// its neighbour only in which entryStyle it names, so no host can quietly acquire
// a field shape nobody documented for it.

export function buildEntry(registry, styleName, spec) {
  const style = registry.entryStyles[styleName];
  if (!style) throw new Error(`unknown entryStyle "${styleName}"`);
  const out = {};
  if (style.includeType) out[style.typeField] = style.typeValue;
  for (const [logical, field] of Object.entries(style.fields)) {
    const v = spec[logical];
    if (v === undefined || v === null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) continue;
    out[field] = v;
  }
  return out;
}

function specFor(name, opts, useHttp) {
  if (useHttp) {
    if (!opts.gatewayUrl) throw new Error('an http target needs a gateway url');
    return { url: `${opts.gatewayUrl.replace(/\/+$/, '')}/${domainOf(name)}/mcp` };
  }
  const s = opts.servers[name];
  if (!s) throw new Error(`no launch spec for server "${name}"`);
  return { command: s.command, args: s.args, env: s.env };
}

// The server collection in the target's own container shape. A map for eight of
// the nine; a LIST whose entries carry their own name field for Continue, which
// is the single most likely thing to get wrong by translating a config
// field-for-field from another host.
export function buildServers(registry, target, opts) {
  const useHttp = opts.transport === 'http';
  const style = useHttp ? target.httpStyle : target.stdioStyle;
  if (!style) throw new Error(`target "${target.id}" has no ${useHttp ? 'http' : 'stdio'} entry style`);
  const names = Object.keys(opts.servers);

  if (target.collection === 'list') {
    const nameField = target.nameField || 'name';
    return names.map((name) => ({ [nameField]: name, ...buildEntry(registry, style, specFor(name, opts, useHttp)) }));
  }
  const map = {};
  for (const name of names) map[name] = buildEntry(registry, style, specFor(name, opts, useHttp));
  return map;
}

// SEC-3. buildEntry only carries `env` through for entryStyles that declare an
// `env` field -- the stdio ones -- so a target with no serversKey at all
// (open-webui, n8n, openai, copilot-studio) never produces a built collection
// for validateShape's own entry loop to walk below. Two of those targets'
// snippet bodies (open-webui's pre-0.6.31 mcpo bridge, openai's Agents SDK
// example) still read opts.servers[name].env directly to build their own text,
// entirely outside buildEntry/buildServers. This checks the SOURCE data every
// emitter draws from, unconditionally, so "no serversKey" stops meaning "no
// check" -- every target is bound by the same allowlist, collection or not.
export function checkServerEnvAllowlist(opts, target) {
  const problems = [];
  for (const [name, s] of Object.entries(opts?.servers || {})) {
    const env = s && s.env;
    if (!env || typeof env !== 'object') continue;
    for (const k of Object.keys(env)) {
      if (!HOST_CONFIG_ENV_ALLOWLIST.has(k)) {
        problems.push(
          `server "${name}" carries env "${k}", which is not a capability gate ` +
            `(${[...HOST_CONFIG_ENV_ALLOWLIST].join(', ')}); it must not reach a host config` +
            (target ? ` for ${target.id}.` : '.')
        );
      }
    }
    if (SECRET_VALUE_PATTERN.test(JSON.stringify(env))) {
      problems.push(
        `server "${name}"'s env appears to carry a credential; it must not reach a host config` +
          (target ? ` for ${target.id}.` : '.')
      );
    }
  }
  return problems;
}

// ─── Shape validation ────────────────────────────────────────────────────────
// Built, then checked back against the registry it was built from. This is what
// gives the negative control in test-host-emitters.mjs any meaning: a deliberately
// malformed emitter has to be REJECTED here, not merely produce different bytes
// that a human might or might not notice.

export function validateShape(registry, target, doc, opts) {
  const problems = [...checkServerEnvAllowlist(opts, target)];
  const key = target.serversKey;
  if (!key) return problems; // snippet-only targets carry no server collection to shape-check further

  const useHttp = opts.transport === 'http';
  const style = registry.entryStyles[useHttp ? target.httpStyle : target.stdioStyle];
  if (!style) {
    problems.push(`target "${target.id}" has no ${useHttp ? 'http' : 'stdio'} entry style`);
    return problems;
  }

  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    problems.push('the emitted document is not an object');
    return problems;
  }
  if (!Object.prototype.hasOwnProperty.call(doc, key)) {
    problems.push(`top-level key "${key}" is missing`);
    return problems;
  }
  const coll = doc[key];

  let entries;
  if (target.collection === 'list') {
    if (!Array.isArray(coll)) {
      problems.push(`"${key}" must be a LIST for ${target.id}, got ${coll === null ? 'null' : typeof coll}`);
      return problems;
    }
    const nf = target.nameField || 'name';
    for (const e of coll) {
      if (e === null || typeof e !== 'object' || typeof e[nf] !== 'string' || !e[nf]) {
        problems.push(`a "${key}" list entry has no "${nf}"`);
      }
    }
    entries = coll.filter((e) => e && typeof e === 'object').map((e) => [e[nf], e]);
  } else {
    if (coll === null || typeof coll !== 'object' || Array.isArray(coll)) {
      problems.push(`"${key}" must be a MAP for ${target.id}, got ${Array.isArray(coll) ? 'array' : coll === null ? 'null' : typeof coll}`);
      return problems;
    }
    entries = Object.entries(coll);
  }

  const managed = new Set(Object.keys(opts.servers));
  for (const name of managed) {
    if (!entries.some(([n]) => n === name)) problems.push(`selected server "${name}" is missing from the emitted config`);
  }

  for (const [name, entry] of entries) {
    if (!managed.has(name)) continue; // unmanaged neighbours are not ours to judge
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      problems.push(`"${name}" is not an object`);
      continue;
    }
    if (style.includeType && entry[style.typeField] !== style.typeValue) {
      problems.push(`"${name}" must carry ${style.typeField}="${style.typeValue}" (got ${JSON.stringify(entry[style.typeField])})`);
    }
    // Claude Code's own documented error: an entry with a url and no type is read
    // as stdio and fails. Any host that declares a typed http style must produce
    // the type, and no host may produce both a url and a command.
    if (entry.url !== undefined && entry.command !== undefined) {
      problems.push(`"${name}" has both a url and a command`);
    }

    if (useHttp) {
      if (typeof entry.url !== 'string' || !/^https?:\/\/[^\s]+$/.test(entry.url)) {
        problems.push(`"${name}" needs an http(s) url (got ${JSON.stringify(entry.url)})`);
      }
      if (entry.command !== undefined) problems.push(`"${name}" is an http entry but carries a command`);
    } else {
      if (typeof entry.command !== 'string' || !entry.command) {
        problems.push(`"${name}" needs a command (got ${JSON.stringify(entry.command)})`);
      }
      if (entry.args !== undefined) {
        if (!Array.isArray(entry.args)) problems.push(`"${name}".args must be an array`);
        else if (entry.args.some((a) => typeof a !== 'string')) problems.push(`"${name}".args must be all strings`);
      }
      if (entry.env !== undefined) {
        if (entry.env === null || typeof entry.env !== 'object' || Array.isArray(entry.env)) {
          problems.push(`"${name}".env must be an object`);
        } else {
          for (const [k, v] of Object.entries(entry.env)) {
            if (typeof v !== 'string') problems.push(`"${name}".env.${k} must be a string (got ${typeof v})`);
          }
          if (!target.envSupported && Object.keys(entry.env).length) {
            problems.push(`"${name}" carries env but ${target.id} does not support env`);
          }
        }
      }
    }

    // A credential must never reach a host config file. Absolute, cheap, and
    // checked on every emit rather than left to code review. The suite's design
    // is that the config carries only a PATH to the env file.
    //
    // This was a blocklist of two names — BCONNECT_API_KEY and
    // BCONNECT_PASSWORD — and the Phase 4 installer audit measured what that
    // cost: BCONNECT_V11_PASSWORD, BCONNECT_V11_USERNAME and
    // MCP_GATEWAY_AUTH_TOKEN were all accepted into a host config file, and the
    // v1.1 password is the highest-value credential in the whole install.
    //
    // A blocklist of secret names is open-ended and drifts every time a
    // credential is added — which is precisely the defect class this project
    // keeps finding. The set of things that legitimately BELONG in a host
    // config, by contrast, is closed: capability gates, and nothing else. So
    // this is an allowlist, and a new secret is safe by default.
    if (entry && typeof entry.env === 'object' && entry.env !== null) {
      for (const key of Object.keys(entry.env)) {
        if (!HOST_CONFIG_ENV_ALLOWLIST.has(key)) {
          problems.push(
            `"${name}" sets env "${key}" in a host config. Only capability gates belong here ` +
              `(${[...HOST_CONFIG_ENV_ALLOWLIST].join(', ')}); everything else — credentials above all — ` +
              `belongs in the env file the config points at.`
          );
        }
      }
    }
    // Defence in depth, on the serialised entry, for anything that reaches a
    // host config by a route other than an `env` block.
    const flat = JSON.stringify(entry);
    if (SECRET_VALUE_PATTERN.test(flat)) {
      problems.push(`"${name}" appears to carry a credential; a host config may only reference the env file`);
    }
  }
  return problems;
}

/**
 * The only env keys a host config may carry: capability gates, which decide
 * what a server exposes and are not secret. Deliberately closed — see the
 * reasoning at the call site.
 */
export const HOST_CONFIG_ENV_ALLOWLIST = new Set([
  'ALLOW_WRITE_OPERATIONS',
  'ALLOWED_WRITE_TOOLS',
  'BCONNECT_ENABLE_V11',
]);

/**
 * Secret-shaped keys, as a backstop rather than as the primary control.
 * Matches any BCONNECT_/MCP_ key ending in KEY, PASSWORD, TOKEN or SECRET, the
 * v1.1 username (half of a Basic credential pair), and the API-key header.
 *
 * TWO forms, and the second is not decoration. The first alternative is
 * JSON-shaped -- a quoted key followed by a colon -- which is what every emitter
 * produced while every emitter produced JSON. The Codex target emits TOML, where
 * the same leak reads `BCONNECT_API_KEY = 'aaaa'`: no quotes on the key, an
 * equals sign instead of a colon, and therefore invisible to the JSON form. A
 * new emitter that slipped past this backstop would re-open SEC-3, so the
 * unquoted `KEY =` / `KEY:` form is matched as well.
 *
 * The unquoted form deliberately requires an assignment character immediately
 * after the name. Every emitted page MENTIONS these names in prose -- "the
 * `MCP_GATEWAY_AUTH_TOKEN` line in the credentials file" -- and a mention is not
 * a leak; an assignment is.
 */
/**
 * The `(?:__[A-Z0-9]+)?` tail is not decoration, and it was added after being
 * measured missing. The secret words used to have to END the name, so
 * `BCONNECT_API_KEY` was detected and the per-server form
 * `BCONNECT_API_KEY__JOBS` was NOT -- it ends in `JOBS`. Verified against this
 * module's own export before and after: `containsSecretShapedValue` answered
 * false for `{"BCONNECT_API_KEY__JOBS":"abc"}`.
 *
 * Nothing could route such a name into a host config today, because
 * HOST_CONFIG_ENV_ALLOWLIST is closed and admits three non-secret flags. That
 * is precisely why this is worth fixing rather than shrugging at: this pattern
 * is the DEFENCE IN DEPTH behind that allowlist, and a backstop with a hole in
 * exactly the shape of a newly-introduced credential name is the kind of thing
 * that is discovered later, by someone else, in a file that already shipped.
 */
const SECRET_VALUE_PATTERN = new RegExp(
  [
    // JSON: "BCONNECT_API_KEY": "..."   and   "BCONNECT_API_KEY__JOBS": "..."
    '"(?:BCONNECT|MCP)_[A-Z0-9_]*(?:KEY|PASSWORD|TOKEN|SECRET|USERNAME)(?:__[A-Z0-9]+)?"\\s*:',
    // TOML / YAML / dotenv: BCONNECT_API_KEY = '...'   BCONNECT_API_KEY: ...
    '(?:^|[\\s{,[])(?:BCONNECT|MCP)_[A-Z0-9_]*(?:KEY|PASSWORD|TOKEN|SECRET|USERNAME)(?:__[A-Z0-9]+)?\\s*[=:]',
    'x-api-key',
  ].join('|'),
  'im',
);

/**
 * SEC-3 defence in depth: run the same backstop over a fully rendered file, not
 * just over the structured entries validateShape walks. Every emitted-text path
 * (emit-host-config.mjs's writeTextFile) runs this immediately before writing,
 * so a leak that reaches the page by some route other than an `env` block --
 * including one of the four targets that have no serversKey to shape-check at
 * all -- is still caught at the last possible moment.
 */
export function containsSecretShapedValue(text) {
  return SECRET_VALUE_PATTERN.test(text);
}

// ─── YAML ────────────────────────────────────────────────────────────────────
// A deliberately tiny serialiser for the shapes this module produces: strings,
// string arrays, string maps and lists of those. Single-quoted scalars with
// doubled internal quotes, which is valid YAML for every byte a Windows path, an
// argument or a URL can contain.
//
// It is NOT a general YAML writer, and that limitation is the reason LibreChat is
// a snippet rather than a merge: we never re-serialise a file a human wrote,
// because this would drop their comments and anchors on the floor.

export function yamlScalar(v) {
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
}

export function yamlBlock(value, indent = 0) {
  const pad = ' '.repeat(indent);
  const lines = [];
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
        const sub = yamlBlock(item, indent + 2).split('\n');
        lines.push(`${pad}- ${sub[0].slice(indent + 2)}`);
        for (const l of sub.slice(1)) if (l.trim()) lines.push(l);
      } else {
        lines.push(`${pad}- ${yamlScalar(item)}`);
      }
    }
    return lines.join('\n');
  }
  for (const [k, v] of Object.entries(value)) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'object') {
      const empty = Array.isArray(v) ? v.length === 0 : Object.keys(v).length === 0;
      if (empty) continue;
      lines.push(`${pad}${k}:`);
      lines.push(yamlBlock(v, indent + 2));
    } else {
      lines.push(`${pad}${k}: ${yamlScalar(v)}`);
    }
  }
  return lines.join('\n');
}

// ─── TOML ────────────────────────────────────────────────────────────────────
// The Codex target (~/.codex/config.toml) is the first non-JSON file this
// installer OWNS rather than hands over as a snippet, and the file it owns is
// one the operator also owns: their model, approval policy, profiles, and every
// other MCP server they have configured live in it. So the risk here is not
// "does the emitted table parse" -- it is "does merging into that file destroy
// something that was already in it".
//
// The answer is a TEXTUAL SPLICE, not a parse-and-re-serialise. The file is cut
// into its table sections; the sections that belong to us are replaced; every
// other section is carried across as the EXACT SAME LINES, in the same order.
// Comments, blank lines, key order and formatting survive because they are never
// re-generated. That is the same reason LibreChat is a snippet rather than a
// merge -- we do not re-serialise a file a human wrote -- applied to a file we
// can nonetheless edit safely, because a TOML table has an unambiguous start.
//
// Where the splice cannot be sure, it REFUSES. An `mcp_servers` inline table in
// the preamble, an `[[mcp_servers...]]` array of tables, or one of our server
// names defined as a key inside a bare `[mcp_servers]` table are all shapes this
// splicer will not attempt; each throws, and the caller leaves the file alone.

const TOML_BARE_KEY = /^[A-Za-z0-9_-]+$/;

function tomlBasicString(value) {
  let out = '"';
  for (const ch of String(value)) {
    const code = ch.codePointAt(0);
    if (ch === '\\') out += '\\\\';
    else if (ch === '"') out += '\\"';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (ch === '\b') out += '\\b';
    else if (ch === '\f') out += '\\f';
    else if (code < 0x20 || code === 0x7f) out += '\\u' + code.toString(16).padStart(4, '0');
    else out += ch;
  }
  return out + '"';
}

/** A table/key name, bare where TOML allows it and quoted where it does not. */
export function tomlKey(name) {
  const s = String(name);
  return TOML_BARE_KEY.test(s) ? s : tomlBasicString(s);
}

/**
 * A scalar, preferring the LITERAL string form.
 *
 * This is the single most consequential line in the TOML emitter. A TOML basic
 * string processes backslash escapes, so `C:\Users\svc\node.exe` written as a
 * basic string needs every backslash doubled and `\U` is a unicode escape that
 * fails to parse outright. A literal string processes nothing at all, so a
 * Windows path goes in exactly as typed. The only thing a literal string cannot
 * carry is a single quote (or a control character), and that is the one case
 * that falls back to a fully escaped basic string.
 */
export function tomlScalar(value) {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  const s = String(value);
  if (!/['\u0000-\u001f\u007f]/.test(s)) return `'${s}'`;
  return tomlBasicString(s);
}

export function tomlArray(items) {
  return '[' + items.map((v) => tomlScalar(v)).join(', ') + ']';
}

// Inside the table, never above it. A comment written ABOVE a header belongs to
// the section before it as far as any line-based splitter is concerned, so a
// provenance line placed there would be orphaned the moment the table it
// describes is removed. One line below the header is removed with it.
const TOML_MANAGED_NOTE =
  '# Managed by bConnect-MCP. This table is written whole and replaced whole.';

/**
 * Our server tables, as lines. One `[<serversKey>.<name>]` table per server plus
 * a `[<serversKey>.<name>.env]` sub-table where there is an env block to carry.
 */
export function renderTomlServerBlocks(target, collection) {
  const key = target.serversKey;
  const blocks = [];
  for (const [name, entry] of Object.entries(collection || {})) {
    const path = `${tomlKey(key)}.${tomlKey(name)}`;
    const lines = [`[${path}]`, TOML_MANAGED_NOTE];
    for (const [field, value] of Object.entries(entry)) {
      if (field === 'env') continue;
      if (value === undefined || value === null) continue;
      lines.push(`${tomlKey(field)} = ${Array.isArray(value) ? tomlArray(value) : tomlScalar(value)}`);
    }
    const env = entry.env;
    if (env && typeof env === 'object' && Object.keys(env).length) {
      lines.push('', `[${path}.env]`);
      for (const [k, v] of Object.entries(env)) lines.push(`${tomlKey(k)} = ${tomlScalar(v)}`);
    }
    blocks.push({ name, lines });
  }
  return blocks;
}

// ── the line scanner ─────────────────────────────────────────────────────────
// Everything below needs one fact per line: is this line inside a multi-line
// string? A `[mcp_servers.x]` inside a triple-quoted value is text, not a table
// header, and a splitter that cannot tell the difference will cut a file in the
// middle of somebody's prompt template.

function tomlConsumeMultiline(line, from, delim) {
  let i = from;
  while (i < line.length) {
    if (delim === '"""' && line[i] === '\\') { i += 2; continue; }
    if (line.startsWith(delim, i)) return i + 3;
    i++;
  }
  return -1;
}

/** The multi-line-string state at the END of `line`, given the state at its start. */
function tomlScanLine(line, state) {
  let i = 0;
  if (state) {
    const end = tomlConsumeMultiline(line, 0, state);
    if (end === -1) return state;
    i = end;
  }
  while (i < line.length) {
    const ch = line[i];
    if (ch === '#') return null; // a comment runs to the end of the line
    if (line.startsWith('"""', i) || line.startsWith("'''", i)) {
      const delim = line.slice(i, i + 3);
      const end = tomlConsumeMultiline(line, i + 3, delim);
      if (end === -1) return delim;
      i = end;
      continue;
    }
    if (ch === '"') {
      i++;
      while (i < line.length && line[i] !== '"') { if (line[i] === '\\') i++; i++; }
      i++;
      continue;
    }
    if (ch === "'") {
      i++;
      while (i < line.length && line[i] !== "'") i++;
      i++;
      continue;
    }
    i++;
  }
  return null;
}

function tomlReadKeyPath(line, start) {
  let i = start;
  const path = [];
  for (;;) {
    while (line[i] === ' ' || line[i] === '\t') i++;
    if (line[i] === '"') {
      let j = i + 1;
      let s = '';
      while (j < line.length && line[j] !== '"') {
        if (line[j] === '\\') { s += line[j + 1] === '\\' ? '\\' : line[j + 1]; j += 2; continue; }
        s += line[j];
        j++;
      }
      if (line[j] !== '"') throw new Error(`unterminated quoted key in: ${line.trim()}`);
      path.push(s);
      i = j + 1;
    } else if (line[i] === "'") {
      const j = line.indexOf("'", i + 1);
      if (j === -1) throw new Error(`unterminated quoted key in: ${line.trim()}`);
      path.push(line.slice(i + 1, j));
      i = j + 1;
    } else {
      const s = i;
      while (i < line.length && /[A-Za-z0-9_-]/.test(line[i])) i++;
      if (i === s) throw new Error(`unparsable key in: ${line.trim()}`);
      path.push(line.slice(s, i));
    }
    while (line[i] === ' ' || line[i] === '\t') i++;
    if (line[i] === '.') { i++; continue; }
    return { path, at: i };
  }
}

function tomlParseHeader(line) {
  const m = /^\s*(\[\[?)/.exec(line);
  const isArray = m[1] === '[[';
  const { path, at } = tomlReadKeyPath(line, m[0].length);
  const close = isArray ? ']]' : ']';
  if (!line.startsWith(close, at)) throw new Error(`unparsable TOML table header: ${line.trim()}`);
  return { path, isArray };
}

/**
 * The file cut into a preamble and a list of table sections, as LINE RANGES over
 * the original lines. Nothing is re-rendered, so anything carried across comes
 * back byte-for-byte.
 */
export function splitTomlSections(raw) {
  let text = String(raw ?? '');
  let bom = '';
  if (text.charCodeAt(0) === 0xfeff) { bom = '\ufeff'; text = text.slice(1); }
  // Lines keep their trailing \r, so joining with \n reproduces the input exactly
  // and a CRLF file stays a CRLF file without anything having to convert it.
  //
  // The empty element AFTER a file's final newline is dropped. It is a
  // terminator, not a line: leaving it in means the LAST table's line range ends
  // with a blank that carries no \r, and splicing anything after that table
  // produces one bare LF in the middle of a CRLF file.
  const lines = text === '' ? [] : text.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  const eol = /\r\n/.test(text) ? '\r\n' : '\n';

  const sections = [];
  let preambleEnd = lines.length;
  let state = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '');
    const startState = state;
    state = tomlScanLine(line, state);
    if (startState) continue; // this line began inside a multi-line string
    if (!line.trimStart().startsWith('[')) continue;
    const header = tomlParseHeader(line);
    if (!sections.length) preambleEnd = i;
    else sections[sections.length - 1].end = i;
    sections.push({ ...header, start: i, end: lines.length });
  }
  if (state) throw new Error('the file ends inside an unterminated multi-line string');
  return { bom, eol, lines, preambleEnd, sections };
}

/** The first segment of every key assigned in a range of lines. */
function tomlAssignedKeys(doc, from, to) {
  const found = new Set();
  let state = null;
  for (let i = from; i < to; i++) {
    const line = doc.lines[i].replace(/\r$/, '');
    const startState = state;
    state = tomlScanLine(line, state);
    if (startState) continue;
    const trimmed = line.trimStart();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('[')) continue;
    let parsed;
    try {
      parsed = tomlReadKeyPath(line, line.length - trimmed.length);
    } catch { continue; }
    if (line[parsed.at] === '=') found.add(parsed.path[0]);
  }
  return found;
}

/**
 * Merge our server tables into an existing config.toml, or produce one from
 * nothing.
 *
 * Returns the new text plus the accounting the caller needs to PROVE it did not
 * touch anything else: the foreign sections it carried across, and the preamble
 * it did not rewrite.
 */
export function mergeTomlText(existingText, target, collection, removeNames = []) {
  const key = target.serversKey;
  const doc = splitTomlSections(existingText || '');
  const ours = Object.keys(collection || {});
  const ourSet = new Set(ours);
  const removeSet = new Set(removeNames || []);
  const claimed = (name) => ourSet.has(name) || removeSet.has(name);

  // ── the shapes this splicer will not attempt ──────────────────────────────
  // Each of these is legal TOML that means the same thing as the table form, and
  // each would need the file re-serialised to edit safely. Refusing is the whole
  // point: the caller writes nothing and the operator still has their file.
  if (tomlAssignedKeys(doc, 0, doc.preambleEnd).has(key)) {
    throw new Error(
      `this file defines "${key}" as a top-level key rather than as [${key}.<name>] tables. ` +
        'Editing that shape safely would mean re-serialising the whole file, which would drop ' +
        'its comments and formatting, so nothing was written.',
    );
  }
  for (const s of doc.sections) {
    if (s.path[0] !== key) continue;
    if (s.isArray) {
      throw new Error(
        `this file carries an [[${key}...]] array of tables, which is not the shape ` +
          `${target.id} documents and not a shape this installer will edit; nothing was written.`,
      );
    }
    if (s.path.length === 1) {
      const clash = [...tomlAssignedKeys(doc, s.start + 1, s.end)].filter(claimed);
      if (clash.length) {
        throw new Error(
          `[${key}] in this file already defines ${clash.join(', ')} as inline key(s). ` +
            `Remove those line(s) and re-run, or the installer would end up with two ` +
            `definitions of the same server. Nothing was written.`,
        );
      }
    }
  }

  // ── the splice ────────────────────────────────────────────────────────────
  const isOurs = (s) => s.path[0] === key && s.path.length >= 2 && claimed(s.path[1]);
  const previous = new Map(); // server name -> the exact lines it occupied
  for (const s of doc.sections) {
    if (!isOurs(s)) continue;
    const name = s.path[1];
    if (!previous.has(name)) previous.set(name, []);
    previous.get(name).push(...doc.lines.slice(s.start, s.end));
  }

  const blocks = renderTomlServerBlocks(target, collection || {});
  // Lines are joined with \n, so on a CRLF file every line -- blank ones
  // included -- carries its own trailing \r. The one exception is the empty
  // element AFTER the final newline, which is a terminator rather than a line.
  const decorate = (line) => (doc.eol === '\r\n' ? line + '\r' : line);

  const added = [];
  const updated = [];
  const removed = [];
  for (const b of blocks) {
    const before = previous.get(b.name);
    if (!before) added.push(b.name);
    else if (before.map((l) => l.replace(/\r$/, '')).join('\n').trim() !== b.lines.join('\n').trim()) {
      updated.push(b.name);
    }
  }
  for (const name of removeSet) if (previous.has(name)) removed.push(name);

  const out = doc.lines.slice(0, doc.preambleEnd);
  const foreignSections = [];
  let anchored = false;
  const insert = () => {
    if (anchored) return;
    anchored = true;
    for (const b of blocks) {
      if (out.length && out[out.length - 1].replace(/\r$/, '').trim() !== '') out.push(decorate(''));
      for (const l of b.lines) out.push(decorate(l));
    }
    // Our tables may be spliced into the MIDDLE of the file, in which case the
    // next foreign header would otherwise be glued to our last key.
    if (blocks.length) out.push(decorate(''));
  };
  for (const s of doc.sections) {
    if (isOurs(s)) { insert(); continue; }
    foreignSections.push(s.path.join('.'));
    out.push(...doc.lines.slice(s.start, s.end));
  }
  insert(); // nothing of ours was in the file: our tables go at the end

  // A file created from nothing has an empty preamble, which is still one blank
  // line, and a config that opens on a blank line reads as a truncation. Only
  // when the whole input was blank: a file that merely STARTS with blank lines
  // keeps them, because those bytes are the operator's.
  if (!String(existingText || '').trim()) {
    while (out.length && out[0].replace(/\r$/, '') === '') out.shift();
  }
  // Exactly one trailing newline, which is what every editor and every diff
  // expects and what the file almost certainly already had.
  while (out.length && out[out.length - 1].replace(/\r$/, '') === '') out.pop();
  out.push('');

  return {
    text: doc.bom + out.join('\n'),
    added,
    updated,
    removed,
    foreignSections,
    preamble: doc.lines.slice(0, doc.preambleEnd).join('\n'),
    preambleKeys: [...tomlAssignedKeys(doc, 0, doc.preambleEnd)],
  };
}

/**
 * A tolerant TOML reader, for verification rather than for editing.
 *
 * Two callers: the post-write check in emit-host-config.mjs, which re-reads what
 * it just wrote and confirms our tables came back with the right command, args
 * and env; and verify-host-config.mjs, which starts the servers named in a
 * Codex config file. Both parse a WHOLE file that may carry settings this
 * installer knows nothing about, so an unrecognised value (an offset date-time,
 * say) is kept as its raw text rather than thrown at the operator. Structural
 * damage -- an unterminated string, a malformed header -- still throws, because
 * that is a file the host itself would reject.
 */
export function parseToml(text) {
  const s = String(text ?? '').replace(/^\ufeff/, '');
  let i = 0;
  const root = {};
  let cur = root;

  const isWs = (c) => c === ' ' || c === '\t';
  const isNl = (c) => c === '\n' || c === '\r';
  const skipInline = () => { while (i < s.length && isWs(s[i])) i++; };
  const skipToEol = () => { while (i < s.length && !isNl(s[i])) i++; };
  const skipBlank = () => {
    for (;;) {
      const before = i;
      while (i < s.length && (isWs(s[i]) || isNl(s[i]))) i++;
      if (s[i] === '#') skipToEol();
      if (i === before) return;
    }
  };

  function basicString() {
    i++; // opening quote
    let out = '';
    while (i < s.length && s[i] !== '"') {
      if (s[i] === '\\') { out += unescape(); continue; }
      out += s[i++];
    }
    if (s[i] !== '"') throw new Error('unterminated string');
    i++;
    return out;
  }
  function unescape() {
    i++; // backslash
    const c = s[i++];
    switch (c) {
      case 'b': return '\b';
      case 't': return '\t';
      case 'n': return '\n';
      case 'f': return '\f';
      case 'r': return '\r';
      case '"': return '"';
      case '\\': return '\\';
      case 'u': { const h = s.slice(i, i + 4); i += 4; return String.fromCodePoint(parseInt(h, 16)); }
      case 'U': { const h = s.slice(i, i + 8); i += 8; return String.fromCodePoint(parseInt(h, 16)); }
      default:
        // A backslash before a newline in a multi-line basic string swallows the
        // whitespace that follows it.
        if (c === '\n' || c === '\r') { while (i < s.length && (isWs(s[i]) || isNl(s[i]))) i++; return ''; }
        return c;
    }
  }
  function literalString() {
    i++;
    const end = s.indexOf("'", i);
    if (end === -1) throw new Error('unterminated literal string');
    const out = s.slice(i, end);
    i = end + 1;
    return out;
  }
  function multiline(delim) {
    i += 3;
    if (s[i] === '\r') i++;
    if (s[i] === '\n') i++;
    let out = '';
    for (;;) {
      if (i >= s.length) throw new Error('unterminated multi-line string');
      if (s.startsWith(delim, i)) { i += 3; return out; }
      if (delim === '"""' && s[i] === '\\') { out += unescape(); continue; }
      out += s[i++];
    }
  }
  function value() {
    const c = s[i];
    if (s.startsWith('"""', i)) return multiline('"""');
    if (s.startsWith("'''", i)) return multiline("'''");
    if (c === '"') return basicString();
    if (c === "'") return literalString();
    if (c === '[') {
      i++;
      const arr = [];
      for (;;) {
        skipBlank();
        if (s[i] === ']') { i++; return arr; }
        if (i >= s.length) throw new Error('unterminated array');
        arr.push(value());
        skipBlank();
        if (s[i] === ',') { i++; continue; }
        skipBlank();
        if (s[i] === ']') { i++; return arr; }
        throw new Error('unterminated array');
      }
    }
    if (c === '{') {
      i++;
      const obj = {};
      skipInline();
      if (s[i] === '}') { i++; return obj; }
      for (;;) {
        skipInline();
        const { path } = keyPath();
        skipInline();
        if (s[i] !== '=') throw new Error('inline table entry without a value');
        i++;
        skipInline();
        assign(obj, path, value());
        skipInline();
        if (s[i] === ',') { i++; continue; }
        if (s[i] === '}') { i++; return obj; }
        throw new Error('unterminated inline table');
      }
    }
    const start = i;
    while (i < s.length && !isNl(s[i]) && s[i] !== ',' && s[i] !== ']' && s[i] !== '}' && s[i] !== '#') i++;
    const raw = s.slice(start, i).trim();
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    if (/^[+-]?(?:\d[\d_]*)$/.test(raw)) return Number(raw.replace(/_/g, ''));
    if (/^[+-]?(?:\d[\d_]*)\.\d[\d_]*(?:[eE][+-]?\d+)?$/.test(raw)) return Number(raw.replace(/_/g, ''));
    if (/^0x[0-9a-fA-F_]+$/.test(raw)) return Number(raw.replace(/_/g, ''));
    return raw; // dates, times, anything else this reader does not model
  }
  function keyPath() {
    const rest = s.slice(i);
    const lineEnd = rest.search(/[\r\n]/);
    const line = lineEnd === -1 ? rest : rest.slice(0, lineEnd);
    const r = tomlReadKeyPath(line, 0);
    i += r.at;
    return { path: r.path };
  }
  function assign(obj, path, v) {
    let node = obj;
    for (const seg of path.slice(0, -1)) {
      if (node[seg] === undefined || node[seg] === null || typeof node[seg] !== 'object') node[seg] = {};
      node = node[seg];
    }
    node[path[path.length - 1]] = v;
  }

  for (;;) {
    skipBlank();
    if (i >= s.length) break;
    if (s[i] === '[') {
      const rest = s.slice(i);
      const lineEnd = rest.search(/[\r\n]/);
      const line = lineEnd === -1 ? rest : rest.slice(0, lineEnd);
      const { path, isArray } = tomlParseHeader(line);
      skipToEol();
      let node = root;
      for (const seg of path.slice(0, -1)) {
        if (Array.isArray(node[seg])) node = node[seg][node[seg].length - 1];
        else {
          if (node[seg] === undefined || node[seg] === null || typeof node[seg] !== 'object') node[seg] = {};
          node = node[seg];
        }
      }
      const last = path[path.length - 1];
      if (isArray) {
        if (!Array.isArray(node[last])) node[last] = [];
        const entry = {};
        node[last].push(entry);
        cur = entry;
      } else {
        if (node[last] === undefined || node[last] === null || typeof node[last] !== 'object') node[last] = {};
        cur = node[last];
      }
      continue;
    }
    const { path } = keyPath();
    skipInline();
    if (s[i] !== '=') throw new Error(`expected "=" after key ${path.join('.')}`);
    i++;
    skipInline();
    assign(cur, path, value());
    skipInline();
    if (s[i] === '#') skipToEol();
  }
  return root;
}

// ─── Snippet bodies ──────────────────────────────────────────────────────────
// Each one says what to do, what it does NOT prove, and where the shape came
// from. A snippet that is only a config block is exactly how a target ends up
// "supported" on paper and broken in practice.

const fence = (lang, body) => '```' + lang + '\n' + body + '\n```';

function ctx(opts) {
  const gatewayUrl = (opts.gatewayUrl || 'http://127.0.0.1:3001').replace(/\/+$/, '');
  return {
    gatewayUrl,
    port: opts.gatewayPort ?? 3001,
    hasGateway: !!opts.gatewayUrl,
    // SEC-7 — the gateway authenticates callers with a shared bearer token, and
    // the installer generates one for every gateway run. `false` only when an
    // operator has deliberately configured a token-less gateway.
    authRequired: opts.gatewayAuthRequired !== false,
    domains: Object.keys(opts.servers).map(domainOf),
    servers: opts.servers,
  };
}

/**
 * The auth paragraph every gateway-facing snippet shares.
 *
 * The token VALUE is deliberately absent. These files are written to install\out,
 * which is an ordinary directory an operator will paste from, mail, or check in;
 * the token lives in the ACL-hardened credentials file and is printed once by the
 * installer. Naming the header and the file is enough to act on and leaks nothing.
 */
function authParagraph(c, { headerHow = null } = {}) {
  if (!c.authRequired) {
    return [
      '**Authentication: none is configured on this gateway.** It will only have',
      'started at all on a loopback bind, or with `MCP_ALLOW_NO_AUTH=true` asserting',
      'that an authenticating reverse proxy is in front. Set `MCP_GATEWAY_AUTH_TOKEN`',
      '(or re-run the installer with `-Gateway`) to require a token here too.',
    ];
  }
  return [
    '**Authentication: required.** Every request must carry',
    '',
    fence('text', 'Authorization: Bearer <MCP_GATEWAY_AUTH_TOKEN>'),
    '',
    'The value is the `MCP_GATEWAY_AUTH_TOKEN` line in the installer\'s credentials',
    'file (`secrets\\bconnect.env`, or its `.dpapi` form). It is not reproduced here:',
    'this file is not ACL-protected and the credentials file is. Without the header',
    'the gateway answers **401**.',
    ...(headerHow ? ['', headerHow] : []),
    '',
    'The token authenticates the CALLER. It is not TLS — on anything but loopback,',
    'put a TLS-terminating reverse proxy in front or the token crosses the wire in',
    'clear text.',
  ];
}

export function renderContinueBlockFile(registry, target, opts, collection) {
  return (
    `# bConnect-MCP — generated by install\\Install-BConnectMcp.ps1\n` +
    `# Shape from ${target.docUrl} (read 2026-08-01).\n` +
    `# NOTE: mcpServers here is a LIST of objects, each carrying its own name.\n` +
    yamlBlock({ name: 'bConnect MCP', version: '0.0.1', schema: 'v1', [target.serversKey]: collection }) +
    '\n'
  );
}

export function renderSnippet(registry, target, opts, collection) {
  const c = ctx(opts);
  switch (target.id) {
    case 'librechat': return snippetLibrechat(registry, target, opts, collection, c);
    case 'continue': return snippetContinue(target, collection, opts.outPath, c);
    case 'open-webui': return snippetOpenWebui(target, c);
    case 'n8n': return snippetN8n(target, c);
    case 'openai': return snippetOpenai(target, c);
    case 'copilot-studio': return snippetCopilotStudio(target, c);
    case 'generic': return snippetGeneric(target, collection, c);
    default:
      return `# ${target.label}\n\nSource: ${target.docUrl}\n\n` +
        fence('json', JSON.stringify({ [target.serversKey]: collection }, null, 2)) + '\n';
  }
}

function snippetLibrechat(registry, target, opts, collection, c) {
  const httpColl = c.hasGateway
    ? buildServers(registry, target, { servers: opts.servers, transport: 'http', gatewayUrl: c.gatewayUrl })
    : null;
  return [
    '# LibreChat — bConnect-MCP',
    '',
    `Paste the block below into your \`librechat.yaml\` at the top level.`,
    `Shape from ${target.docUrl} (read 2026-08-01).`,
    '',
    '**Why this is a snippet and not a merge.** `librechat.yaml` is hand-maintained,',
    'with comments and anchors that a re-serialiser destroys silently. This installer',
    'will not rewrite a file it cannot round-trip faithfully, so it hands you the',
    'block instead of pretending it can own the file.',
    '',
    '## stdio — the servers run on the LibreChat host',
    '',
    fence('yaml', yamlBlock({ mcpServers: collection })),
    '',
    'Those are absolute paths **on this machine**. If LibreChat runs in a container,',
    'either the suite and the credentials file are inside that container (or',
    'bind-mounted at the same paths), or use the HTTP form below. `librechat.yaml`',
    'itself must sit in the project root and be mounted into the API container —',
    'editing a copy somewhere else does nothing at all.',
    '',
    httpColl
      ? [
          '## HTTP — through the bConnect MCP gateway',
          '',
          'Use this when LibreChat is containerised or on another host.',
          '',
          fence('yaml', yamlBlock({ mcpServers: httpColl })),
          '',
          ...authParagraph(c, {
            headerHow: 'In `librechat.yaml` that goes in each server\'s `headers:` map.',
          }),
          '',
          'Pointing LibreChat at a private address may also need `allowedDomains` /',
          '`allowedAddresses` under the `mcpSettings` key.',
        ].join('\n')
      : '## HTTP\n\nNot emitted — no gateway was configured in this run.',
    '',
    '## Local models — why this target matters',
    '',
    'LibreChat is one of the two hosts here that runs a **local stdio MCP server**',
    'and drives a **self-hosted model** (Ollama and similar). That combination is the',
    'whole answer to "a machine with no internet access": the model is local, the MCP',
    'servers are local, bMS is on the LAN, and nothing leaves the network.',
    '',
    '## Verified how',
    '',
    'Shape-checked against the documented schema. LibreChat is **not installed** on',
    'the machine that generated this, so nothing here was parsed by LibreChat. The',
    'stdio command line is byte-identical to the one Claude Desktop is given, and',
    'that one is verified live — so the process side is sound and what remains',
    "unproven is LibreChat's reading of this YAML.",
    '',
  ].join('\n');
}

function snippetContinue(target, collection, outPath, c) {
  return [
    '# Continue — bConnect-MCP',
    '',
    outPath ? `Written to \`${outPath}\` as a standalone **block file**.` : 'Block file.',
    `Shape from ${target.docUrl} (read 2026-08-01).`,
    '',
    '## The trap',
    '',
    "Continue's `mcpServers` is a **YAML list of objects, each carrying its own**",
    '`name:` — not a map keyed by server name like every other host on this list. A',
    'config translated field-for-field from a Claude or Cursor file is wrong here and',
    'will not load.',
    '',
    fence('yaml', yamlBlock({ name: 'bConnect MCP', version: '0.0.1', schema: 'v1', mcpServers: collection })),
    '',
    'Alternatively paste just the `mcpServers:` list into `~/.continue/config.yaml`',
    'at the top level, without the name/version/schema header.',
    '',
    'MCP is usable in **agent** mode only.',
    '',
    '## Local models',
    '',
    'Continue pairs a self-hosted model with MCP. Configure your local provider',
    '(Ollama and similar) in `config.yaml` as usual; the block above is independent',
    'of which model runs behind it.',
    '',
    '## Verified how',
    '',
    'Schema-checked only — Continue is not installed on the machine that generated',
    'this, so nothing here was loaded by Continue. The `type: stdio` shape is',
    'confirmed on both the MCP deep dive and the `config.yaml` reference; the',
    '`streamable-http` shape rests on the deep-dive page alone.',
    '',
  ].join('\n');
}

function snippetOpenWebui(target, c) {
  const mcpo = {};
  for (const [name, s] of Object.entries(c.servers)) {
    mcpo[name] = { command: s.command, args: s.args, ...(s.env && Object.keys(s.env).length ? { env: s.env } : {}) };
  }
  return [
    '# Open WebUI — bConnect-MCP',
    '',
    `Source: ${target.docUrl} (read 2026-08-01).`,
    '',
    '## The one fact that decides everything',
    '',
    'Open WebUI has consumed MCP natively since **v0.6.31**, and native support is',
    '**Streamable HTTP only** — there is no stdio path, because a browser cannot hold',
    "a long-lived pipe. That is exactly what this suite's gateway serves, so on",
    '0.6.31+ you do **not** need the mcpo bridge.',
    '',
    '## Native (v0.6.31+) — recommended',
    '',
    'Admin Settings → External Tools → **+ (Add Server)** → Type: **MCP (Streamable',
    'HTTP)**. One entry per bConnect domain:',
    '',
    fence('text', c.domains.map((d) => `${c.gatewayUrl}/${d}/mcp`).join('\n')),
    '',
    ...authParagraph(c, {
      headerHow:
        'In Open WebUI that is the server entry\'s **Auth: Bearer** field (paste the\n' +
        'token alone, without the word `Bearer`), or a custom `Authorization` header.',
    }),
    '',
    'If Open WebUI runs in a container and the gateway runs on this Windows host, use',
    `\`http://host.docker.internal:${c.port}/<domain>/mcp\` — \`localhost\` inside a`,
    'container is the container.',
    '',
    '## Pre-0.6.31 — the mcpo bridge',
    '',
    'mcpo takes a literal Claude-Desktop-shaped JSON via `--config` and re-exposes',
    'each server as OpenAPI, which Open WebUI consumes as a **tool server** URL.',
    '',
    fence('json', JSON.stringify({ mcpServers: mcpo }, null, 2)),
    '',
    fence('text', 'mcpo --config <this file> --port 8000 --api-key "<choose one>"'),
    '',
    'Then add `http://<host>:8000` in Open WebUI as an OpenAPI tool server. Read the',
    'per-server paths off `http://<host>:8000/docs` rather than assuming them — the',
    "multi-server path layout is not stated in mcpo's own documentation.",
    '',
    '## Verified how',
    '',
    'Schema-checked only: Open WebUI is not installed on the machine that generated',
    "this. The URLs are the gateway's real routes, and those were exercised for real",
    "if you ran the installer's gateway verification step.",
    '',
  ].join('\n');
}

function snippetN8n(target, c) {
  return [
    '# n8n — bConnect-MCP',
    '',
    `Source: ${target.docUrl} (read 2026-08-01).`,
    'The suite also ships its own guide at `bConnect-MCP-main\\docs\\N8N.md`.',
    '',
    '## Negative finding, stated first',
    '',
    '**The n8n MCP Client Tool node has no stdio support at all** — no `command`, no',
    '`args`, no local process anywhere in the node. It takes an endpoint URL and a',
    'transport (SSE, or HTTP Streamable from node version 1.2). For n8n the gateway',
    'is therefore not an optimisation, it is the only route.',
    '',
    '## Setup',
    '',
    '1. **Credentials → Add Credential → MCP Server**, one per domain:',
    '',
    fence('text', c.domains.map((d) => `${c.gatewayUrl}/${d}/mcp`).join('\n')),
    '',
    '2. **Authentication: Header Auth.** Create one *Header Auth* credential and',
    '   reuse it on every domain:',
    '',
    fence('text', 'Name:  Authorization\nValue: Bearer <MCP_GATEWAY_AUTH_TOKEN>'),
    '',
    ...authParagraph(c).map((s) => (s ? '   ' + s : s)),
    '',
    '3. Add an **AI Agent** node, then one **Tool: MCP** sub-node per domain.',
    '',
    '## Context cost — the decision that actually matters here',
    '',
    'n8n calls `tools/list` on **every** configured MCP server and injects every',
    'returned schema into the prompt on **every** invocation. Nothing is lazy. All 13',
    'domains is roughly 170,000 tokens before the workflow has done anything at all.',
    'Connect the domains a workflow needs and no more.',
    '',
    '## Check this before you rely on it',
    '',
    'There are open reports of the transport dropdown being ignored and SSE used',
    'regardless, which fails against a streamable-only server such as this gateway.',
    'Confirm the behaviour of your n8n version rather than trusting the dropdown.',
    '',
    '## Verified how',
    '',
    "Schema-checked only — n8n is not installed here. The URLs are the gateway's real",
    'routes.',
    '',
  ].join('\n');
}

function snippetOpenai(target, c) {
  // Every selected domain, not a sample. This block is written BECAUSE those
  // domains were selected, it is a flat array with no length limit, and a
  // complete-looking JSON document that silently holds two of thirteen entries
  // presents later as "the model cannot answer that" rather than as a
  // configuration error.
  const hosted = c.domains.map((d) => ({
    type: 'mcp',
    server_label: `bconnect_${d}`,
    server_description: `baramundi bConnect ${d} tools`,
    server_url: `${c.gatewayUrl}/${d}/mcp`,
    require_approval: 'always',
  }));
  const entries = Object.entries(c.servers);
  const first = entries[0];
  const py = first
    ? [
        `# ${first[0]} shown. Construct one MCPServerStdio per domain and hand the`,
        `# whole set to the Agent; this run selected ${entries.length}: ${c.domains.join(', ')}.`,
        'from agents.mcp import MCPServerStdio',
        '',
        'async with MCPServerStdio(',
        '    params={',
        `        "command": ${JSON.stringify(first[1].command)},`,
        `        "args": ${JSON.stringify(first[1].args)},`,
        ...(first[1].env && Object.keys(first[1].env).length ? [`        "env": ${JSON.stringify(first[1].env)},`] : []),
        '    },',
        ') as server:',
        '    ...  # hand `server` to your Agent',
      ].join('\n')
    : '# no servers selected';
  return [
    '# OpenAI — bConnect-MCP',
    '',
    `Source: ${target.docUrl} (read 2026-08-01).`,
    '',
    '## Two different products, and the difference decides the whole design',
    '',
    '### 1. Agents SDK, `MCPServerStdio` — use this one on a firewalled machine',
    '',
    'Your process spawns the server locally over stdio. No public endpoint, no',
    'gateway, no inbound anything; only the model API call leaves the network.',
    '',
    fence('python', py),
    '',
    '### 2. Responses API hosted MCP tool — needs a publicly reachable URL',
    '',
    "**OpenAI's servers make the call**, so `server_url` must be reachable from the",
    "public internet, or reached through OpenAI's Secure MCP Tunnel (outbound-only,",
    'no inbound firewall hole). A loopback or private-only gateway will not work.',
    '',
    fence('json', JSON.stringify({ tools: hosted }, null, 2)),
    '',
    `All ${hosted.length} selected domain(s) are above; the array is complete, not an excerpt.`,
    '',
    '`require_approval` is left at `"always"` deliberately. This suite can write to a',
    'production estate; do not lower it because a demo felt slow.',
    '',
    "Whether OpenAI's tunnel client ships a supported Windows service is **not**",
    'something this installer could confirm — the documented deployment patterns are',
    'Kubernetes and systemd. Check before planning around it.',
    '',
    '## Verified how',
    '',
    'Schema-checked only. The stdio params are the same command line Claude Desktop',
    'is given, which **is** verified live here; the hosted-tool block is',
    'documentation-derived and was not executed.',
    '',
  ].join('\n');
}

function snippetCopilotStudio(target, c) {
  const d = c.domains[0] || 'endpoints';
  // A Power Platform custom connector addresses ONE endpoint, so this document
  // covers one domain and the rest need one connector each. That is a property of
  // the connector model, not a shortening of the emission -- say so, and name them,
  // rather than leaving a customer to infer that one connector covered all of them.
  const rest = c.domains.filter((x) => x !== d);
  const swagger = [
    "swagger: '2.0'",
    'info:',
    `  title: bConnect MCP (${d})`,
    '  description: baramundi bConnect MCP server, Streamable HTTP',
    '  version: 1.0.0',
    'host: mcp.example.com          # MUST be a public DNS name with a valid certificate',
    'basePath: /',
    'schemes:',
    '  - https',
    'paths:',
    `  /${d}/mcp:`,
    '    post:',
    `      summary: bConnect ${d}`,
    '      x-ms-agentic-protocol: mcp-streamable-1.0',
    '      operationId: InvokeMCP',
    '      responses:',
    "        '200':",
    '          description: Success',
    ...(rest.length
      ? [
          '',
          `# One connector per domain. This document covers "${d}"; repeat it, changing`,
          `# the title and the path, for each of: ${rest.join(', ')}`,
        ]
      : []),
  ].join('\n');
  return [
    '# Microsoft Copilot Studio — bConnect-MCP',
    '',
    `Source: ${target.docUrl} (read 2026-08-01).`,
    '',
    '## Read this before planning around it',
    '',
    '**This is the least practical target in the list, and the reason is structural,',
    'not a missing feature.** Copilot Studio:',
    '',
    '- has **no stdio path** of any kind;',
    '- supports **Streamable HTTP only** (SSE support ended August 2025);',
    '- reaches your server **through Power Platform connectors**, which means the',
    "  call originates in Microsoft's cloud.",
    '',
    'A gateway on loopback, or on a private management VLAN, is therefore unreachable',
    'by construction — not by policy, by network topology.',
    '',
    'Neither Microsoft MCP documentation page mentions the on-premises data gateway,',
    'VNet integration, or any other private-network route. Absence of a documented',
    'path is not proof that none exists, but it is not something to commit a',
    'production integration to either.',
    '',
    '**What that leaves.** Publishing this gateway on a public HTTPS name, or',
    'tunnelling to it. Either way an internet-reachable path now leads to a component',
    'that holds a bConnect service credential. Its **built-in authentication is a',
    'single shared bearer token** — enough to keep the internet out, not enough to',
    'be the only control on an internet-facing endpoint: it does not expire, does not',
    'identify a caller, and cannot be revoked for one consumer. If you do this, the',
    'authenticating TLS-terminating reverse proxy is not optional, the token is a',
    'second layer behind it, and bMS RBAC on that credential is the last line of',
    'defence.',
    '',
    '## If you proceed — custom connector',
    '',
    'Copilot Studio → Tools → Add a tool → New tool → **Model Context Protocol**, or',
    'build a Power Apps custom connector from this Swagger. The marker that makes it',
    'MCP rather than an ordinary REST connector is',
    '`x-ms-agentic-protocol: mcp-streamable-1.0` on a POST operation.',
    '',
    fence('yaml', swagger),
    '',
    ...(rest.length
      ? [
          `A connector addresses one endpoint, so **${c.domains.length} connectors** are needed for the`,
          `domains selected here — one per domain, not one for all of them.`,
          '',
        ]
      : []),
    'Generative orchestration must be enabled on the agent or MCP is unavailable.',
    '',
    '## Verified how',
    '',
    'Documentation-derived, schema-shaped, **nothing executed**. There was no',
    'private-network path available to test, and that absence is itself the finding.',
    '',
  ].join('\n');
}

function snippetGeneric(target, collection, c) {
  const lines = [
    '# Any MCP client — bConnect-MCP',
    '',
    `Transport reference: ${target.docUrl}`,
    '',
    'The fallback that keeps the rest of this honest. Everything below is the same',
    'command line Claude Desktop is given, so if this does not work for your client,',
    'neither does the target that was verified end to end.',
    '',
    '## The exact command line',
    '',
  ];
  for (const [name, s] of Object.entries(c.servers)) {
    lines.push(`### ${name}`, '');
    lines.push(
      fence(
        'text',
        [
          `executable : ${s.command}`,
          ...(s.args || []).map((a, i) => `arg[${i}]     : ${a}`),
          ...Object.entries(s.env || {}).map(([k, v]) => `env        : ${k}=${v}`),
        ].join('\n'),
      ),
    );
    lines.push('', 'Windows (cmd or PowerShell):');
    lines.push(fence('text', `"${s.command}" ${(s.args || []).map((a) => (/[\s"]/.test(a) ? `"${a}"` : a)).join(' ')}`));
    lines.push('', 'POSIX shell:');
    lines.push(
      fence(
        'text',
        `'${s.command.replace(/'/g, "'\\''")}' ${(s.args || []).map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(' ')}`,
      ),
    );
    lines.push('');
  }
  lines.push(
    '## Portable JSON',
    '',
    'The `mcpServers` map with an explicit `"type": "stdio"`. Most clients take this',
    'verbatim. If yours uses a different top-level key — VS Code uses `servers`,',
    'Continue uses a **list** whose entries carry their own `name` — rename or',
    'reshape the container and keep the entries.',
    '',
    fence('json', JSON.stringify({ mcpServers: collection }, null, 2)),
    '',
  );
  if (c.hasGateway) {
    lines.push(
      '## Over HTTP instead',
      '',
      'For a client that cannot spawn a local process, the gateway serves the same',
      'tools over Streamable HTTP, one URL per domain:',
      '',
      fence('text', c.domains.map((d) => `POST ${c.gatewayUrl}/${d}/mcp`).join('\n')),
      '',
      ...authParagraph(c),
      '',
      'The gateway also refuses to START on a non-loopback address unless it either',
      'has a token or `MCP_ALLOW_NO_AUTH=true` asserts that an authenticating reverse',
      'proxy is in front of it. That assertion is yours to make truthfully; nothing in',
      'the gateway checks whether it is true.',
      '',
    );
  }
  lines.push(
    '## Environment',
    '',
    'No credential appears anywhere above. The `--env-file` argument points at a file',
    'in an ACL-hardened directory, and that file holds the bConnect URL and key. A',
    'client that cannot pass arguments but can set environment variables may set',
    '`BCONNECT_BASE_URL` and `BCONNECT_API_KEY` directly instead — but then the',
    "credential lives in that client's configuration, which is precisely what this",
    'design avoids.',
    '',
    '## Verified how',
    '',
    'Stronger than it looks. The command line above is not a template — it is the',
    'exact `command` and `args` written into the Claude Desktop configuration on this',
    'machine, and the installer starts every one of them from that file, completes the',
    'MCP handshake and makes a real bMS read call before it reports success. So the',
    '**process side is verified end to end**.',
    '',
    'What is not verified, and cannot be from here, is your particular client\'s',
    'parsing of the JSON block. If it fails, compare it against the four shapes the',
    'installer knows (Claude Code, VS Code, Cursor, Continue) — the differences are',
    'the container key and whether entries are typed, never the command line.',
    '',
  );
  return lines.join('\n');
}
