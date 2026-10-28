import readline from 'readline'
import pino from 'pino'
import * as ns from '@whiskeysockets/baileys'
import { extendSocket } from './socket.js'
import { serialize } from './serialize.js'
import { makeStore } from './store.js'

const B = k => ns[k] ?? ns.default?.[k]
export const baseSocket = () => {
  const d = ns.default
  return typeof d === 'function' ? d : ns.makeWASocket ?? d?.default ?? d?.makeWASocket
}

const ask = q => new Promise(r => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  rl.question(q, a => { rl.close(); r(a.trim()) })
})

// Buat socket yang sudah di-extend + store
export function makeRizaSocket(config = {}, store = makeStore()) {
  const sock = baseSocket()({ logger: pino({ level: 'silent' }), ...config })
  store.bind(sock.ev)
  return extendSocket(sock, store, { logger: config.logger })
}

// Ubah sender LID jadi nomor memakai pemetaan LID bawaan Baileys 7
async function resolveLid(sock, m) {
  if (!m.sender?.endsWith('@lid')) return
  try {
    const pn = await sock.signalRepository?.lidMapping?.getPNForLID(m.sender)
    if (pn) {
      m.senderLid = m.sender
      m.sender = sock.decodeJid(pn.includes('@') ? pn : pn + '@s.whatsapp.net')
      m.number = m.sender.split('@')[0]
    }
  } catch {}
}

/**
 * Jalankan bot lengkap: auth, pairing code, reconnect, serialize pesan.
 * Callback: onSocket, onMessage, onOpen, onClose, onGroupParticipants, onCall
 */
export async function startRiza(opts = {}) {
  const o = {
    session: 'session', pairingNumber: '', autoReconnect: true, autoRead: false,
    browser: ['Riza', 'Chrome', '1.0.0'], logLevel: 'silent', store: makeStore(), ...opts,
  }
  const logger = pino({ level: o.logLevel })
  const { state, saveCreds } = await B('useMultiFileAuthState')(o.session)
  const { version } = await B('fetchLatestBaileysVersion')()

  const sock = makeRizaSocket(
    {
      version, auth: state, logger, browser: o.browser, markOnlineOnConnect: true,
      getMessage: async key => o.store.loadMessage(key.remoteJid, key.id)?.message,
      cachedGroupMetadata: async jid => o.store.groups[jid],
      ...o.socketConfig,
    },
    o.store
  )

  if (!sock.authState.creds.registered) {
    const n = (o.pairingNumber || (await ask('Nomor bot (contoh 628123456789): '))).replace(/\D/g, '')
    setTimeout(async () => {
      const code = await sock.requestPairingCode(n)
      console.log('\nPairing code:', code?.match(/.{1,4}/g)?.join('-') || code, '\n')
    }, 3000)
  }

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
    if (connection === 'open') await o.onOpen?.(sock)
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode
      const loggedOut = code === B('DisconnectReason').loggedOut
      await o.onClose?.({ code, loggedOut, error: lastDisconnect?.error })
      if (!loggedOut && o.autoReconnect) startRiza(o)
    }
  })

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return
    for (const raw of messages) {
      if (!raw.message || raw.key.remoteJid === 'status@broadcast') continue
      try {
        if (o.autoRead) sock.readMessages([raw.key]).catch(() => {})
        const m = serialize(sock, raw)
        await resolveLid(sock, m)
        await o.onMessage?.(m, sock)
      } catch (e) {
        console.error('[riza] onMessage error:', e)
      }
    }
  })
  sock.ev.on('group-participants.update', u => o.onGroupParticipants?.(u, sock))
  sock.ev.on('call', calls => o.onCall?.(calls, sock))

  await o.onSocket?.(sock)
  return sock
}
