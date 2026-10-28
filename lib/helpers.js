import fs from 'fs'

export const sleep = ms => new Promise(r => setTimeout(r, ms))
export const isUrl = s => typeof s === 'string' && /^https?:\/\//i.test(s)
export const numberOf = jid => (jid || '').split('@')[0].split(':')[0]
export const toJid = n => (String(n).includes('@') ? n : String(n).replace(/\D/g, '') + '@s.whatsapp.net')
export const parseMention = text =>
  [...String(text || '').matchAll(/@(\d{5,16})/g)].map(v => v[1] + '@s.whatsapp.net')
export const formatSize = b => {
  const u = ['B', 'KB', 'MB', 'GB']
  let i = 0
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++ }
  return b.toFixed(i ? 1 : 0) + ' ' + u[i]
}

// deteksi tipe file dari magic bytes
export function detectType(buf) {
  const h = (...b) => b.every((x, i) => buf[i] === x)
  const s = (str, off = 0) => buf.slice(off, off + str.length).toString('latin1') === str
  if (h(0xff, 0xd8, 0xff)) return { mime: 'image/jpeg', ext: 'jpg' }
  if (h(0x89, 0x50, 0x4e, 0x47)) return { mime: 'image/png', ext: 'png' }
  if (s('GIF8')) return { mime: 'image/gif', ext: 'gif' }
  if (s('RIFF') && s('WEBP', 8)) return { mime: 'image/webp', ext: 'webp' }
  if (s('ftyp', 4)) {
    const brand = buf.slice(8, 12).toString('latin1')
    if (/^M4A|^M4B/.test(brand)) return { mime: 'audio/mp4', ext: 'm4a' }
    return { mime: 'video/mp4', ext: 'mp4' }
  }
  if (h(0x1a, 0x45, 0xdf, 0xa3)) return { mime: 'video/webm', ext: 'webm' }
  if (s('ID3') || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return { mime: 'audio/mpeg', ext: 'mp3' }
  if (s('OggS')) return { mime: 'audio/ogg', ext: 'ogg' }
  if (s('%PDF')) return { mime: 'application/pdf', ext: 'pdf' }
  if (s('PK')) return { mime: 'application/zip', ext: 'zip' }
  return { mime: 'application/octet-stream', ext: 'bin' }
}

// sumber bisa Buffer, URL, data URI, atau path file lokal
export async function getFile(source) {
  let buffer
  if (Buffer.isBuffer(source)) buffer = source
  else if (source instanceof Uint8Array) buffer = Buffer.from(source)
  else if (isUrl(source)) {
    const r = await fetch(source)
    if (!r.ok) throw new Error('Gagal download file: HTTP ' + r.status)
    buffer = Buffer.from(await r.arrayBuffer())
  } else if (typeof source === 'string' && source.startsWith('data:')) {
    buffer = Buffer.from(source.split(',')[1], 'base64')
  } else if (typeof source === 'string' && fs.existsSync(source)) {
    buffer = fs.readFileSync(source)
  } else throw new Error('Sumber file tidak valid (Buffer, URL, data URI, atau path)')
  return { buffer, size: buffer.length, ...detectType(buffer) }
}

// pecah "!menu a b" jadi { prefix, command, args, text }
export function parseCommand(body, prefixes = ['.', '!', '#', '/']) {
  const prefix = [].concat(prefixes).find(p => body?.startsWith(p))
  if (prefix === undefined) return null
  const [command, ...args] = body.slice(prefix.length).trim().split(/\s+/)
  if (!command) return null
  return { prefix, command: command.toLowerCase(), args, text: args.join(' ') }
}
