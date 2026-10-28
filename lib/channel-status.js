// Channel Status (status di saluran WhatsApp): kirim, reaksi, hapus, dan baca.
// Protokolnya dipelajari dari @rexxhayanasi/elaina-baileys (MIT) lalu ditulis ulang untuk Riza.
// Nama metode dan bentuk hasilnya disamakan dengan Elaina supaya SC yang memakainya tetap jalan.
import fs from 'fs'
import * as ns from '@whiskeysockets/baileys'
import {
  assertNewsletter, buildStatusNode, buildReactionNode, buildRevokeNode,
  mediaTypeOf, parseAck, parseStatuses, parseStatusUpdates, toServerId, child,
} from './status-nodes.js'

const B = k => ns[k] ?? ns.default?.[k]
const ACK_TIMEOUT = 20000
const ECHO_TIMEOUT = 8000
const CAPABILITIES_QUERY = '9801384413216421'
const NEWSLETTER_STATUS_ATTRIBUTION = 9 // proto.StatusAttribution.Type.NEWSLETTER_STATUS
const MEDIA_PATHS = {
  image: '/newsletter/newsletter-image', video: '/newsletter/newsletter-video',
  audio: '/newsletter/newsletter-audio', document: '/newsletter/newsletter-document',
  sticker: '/newsletter/newsletter-image',
}
const urlSafe = b64 => encodeURIComponent(String(b64).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''))

const NAMES = [
  'newsletterCanPostStatus', 'sendNewsletterStatus', 'getNewsletterStatuses',
  'sendNewsletterStatusReaction', 'revokeNewsletterStatus', 'getNewsletterStatusUpdates',
]

export function addChannelStatus(sock) {
  const proto = B('proto')
  const encode = B('encodeNewsletterMessage')
  const generateWAMessage = B('generateWAMessage')
  const generateMessageIDV2 = B('generateMessageIDV2')
  const normalize = B('normalizeMessageContent') || (m => m)
  const S_WHATSAPP_NET = B('S_WHATSAPP_NET') || 's.whatsapp.net'
  const serverAck = B('WAMessageStatus')?.SERVER_ACK ?? 2

  const ready = ['waitForMessage', 'sendNode', 'query', 'refreshMediaConn'].every(k => typeof sock[k] === 'function')
    && proto && encode && generateWAMessage && generateMessageIDV2
  sock.channelStatusSupported = !!ready
  if (!ready) {
    for (const name of NAMES) {
      sock[name] = async () => { throw new Error(`${name}: butuh Baileys 7 (waitForMessage, sendNode, refreshMediaConn)`) }
    }
    return sock
  }

  const me = () => {
    const id = sock.authState?.creds?.me?.id
    if (!id) throw new TypeError('Belum login')
    return id
  }

  // ---- query GraphQL (w:mex) ----
  async function wmex(variables, queryId, dataPath) {
    const result = await sock.query({
      tag: 'iq',
      attrs: { type: 'get', to: S_WHATSAPP_NET, xmlns: 'w:mex' },
      content: [{ tag: 'query', attrs: { query_id: queryId }, content: Buffer.from(JSON.stringify({ variables }), 'utf-8') }],
    })
    const raw = child(result, 'result')?.content
    if (raw) {
      const data = JSON.parse(raw.toString())
      if (data.errors?.length) throw new Error('Server GraphQL error: ' + data.errors.map(e => e.message || 'Unknown').join(', '))
      if (data?.data?.[dataPath] !== undefined) return data.data[dataPath]
    }
    throw new Error('Respons query tidak sesuai bentuk yang diharapkan')
  }

  // ---- kirim node dan tunggu ack ----
  async function sendStatusNode(node, { jid, messageId, timeoutMs = ACK_TIMEOUT }) {
    const waiting = sock.waitForMessage(messageId, timeoutMs)
    waiting.catch(() => {})
    await sock.sendNode(node)
    let response
    try { response = await waiting } catch { response = undefined }
    if (!response) throw new Error(`Ack server untuk status ${messageId} tidak datang (timeout)`)
    return parseAck(response, { jid, messageId })
  }

  // server id status kita dikirim server lewat stanza <status> terpisah
  function waitServerId({ jid, messageId, timeoutMs = ECHO_TIMEOUT }) {
    let finish
    const promise = new Promise(resolve => {
      let done = false
      const onStatus = node => {
        if (node?.tag !== 'status') return
        const a = node.attrs || {}
        if (a.from && a.from !== jid) return
        if (a.id && a.id !== messageId) return
        const id = parseInt(a.server_id, 10)
        if (Number.isFinite(id)) end({ serverId: id, node })
      }
      const end = v => {
        if (done) return
        done = true
        clearTimeout(timer)
        sock.ws.off('CB:status', onStatus)
        resolve(v)
      }
      const timer = setTimeout(() => end(undefined), timeoutMs)
      sock.ws.on('CB:status', onStatus)
      finish = end
    })
    promise.cancel = () => finish(undefined)
    return promise
  }

  // ---- upload media ke endpoint newsletter (tanpa enkripsi), hasilnya ada handle ----
  async function uploadNewsletterMedia(filePath, { mediaType, fileEncSha256B64 }) {
    const body = fs.readFileSync(filePath)
    const token = urlSafe(fileEncSha256B64)
    const path = MEDIA_PATHS[mediaType]
    if (!path) throw new TypeError(`Tipe media tidak didukung untuk upload: ${mediaType}`)
    let info = await sock.refreshMediaConn(false)
    for (const { hostname } of info.hosts) {
      const url = `https://${hostname}${path}/${token}?auth=${encodeURIComponent(info.auth)}&token=${token}&server_thumb_gen=1`
      try {
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', Origin: 'https://web.whatsapp.com' }, body })
        const j = await res.json()
        if (j?.url || j?.direct_path) {
          return {
            mediaUrl: j.url, directPath: j.direct_path, handle: j.handle, fbid: j.fbid, ts: j.ts, meta_hmac: j.meta_hmac,
            thumbnailDirectPath: j.thumbnail_info?.thumbnail_direct_path, thumbnailSha256: j.thumbnail_info?.thumbnail_sha256,
          }
        }
        info = await sock.refreshMediaConn(true)
      } catch (e) {
        sock.logger?.warn?.({ trace: e?.stack }, `Upload ke ${hostname} gagal`)
      }
    }
    throw new Error('Upload media status gagal di semua host')
  }

  // ---- API ----
  sock.newsletterCanPostStatus = async jid => {
    const r = await wmex({ newsletter_id: jid }, CAPABILITIES_QUERY, 'xwa2_newsletter_admin')
    const list = r?.capabilities ?? []
    return { canPost: list.includes('CHANNEL_STATUS_PRODUCER'), canPostMusic: list.includes('CHANNEL_STATUS_MUSIC'), capabilities: list }
  }

  sock.sendNewsletterStatus = async (jid, content, options = {}) => {
    assertNewsletter(jid)
    if (!content || typeof content !== 'object' || Array.isArray(content)) throw new TypeError('Isi status harus berupa object')
    const userJid = me()
    const {
      statusAttribution = true, messageId, ackTimeoutMs, serverIdTimeoutMs, resolveServerId,
      parentServerId, responseServerId, aiContent, mediaId, mediaHandle: givenHandle,
      interactionType: givenInteraction, ...genOptions
    } = options
    const id = messageId || generateMessageIDV2(userJid)

    let uploadedHandle
    const upload = async (filePath, opts) => {
      const r = await uploadNewsletterMedia(filePath, opts)
      uploadedHandle = r.handle ?? uploadedHandle
      return r
    }

    let message
    if (content.question) {
      const q = content.question
      if (typeof q?.text !== 'string' || !q.text) throw new TypeError('question.text wajib diisi')
      message = proto.Message.create({
        questionMessage: proto.Message.FutureProofMessage.create({
          message: { extendedTextMessage: proto.Message.ExtendedTextMessage.create({ text: q.text, contextInfo: { ...(q.contextInfo || {}), isQuestion: true } }) },
        }),
      })
    } else {
      const c = statusAttribution
        ? { ...content, contextInfo: { statusAttributions: [{ type: NEWSLETTER_STATUS_ATTRIBUTION }], featureEligibilities: { canBeReshared: true }, ...(content.contextInfo || {}) } }
        : content
      const full = await generateWAMessage(jid, c, { userJid, upload, logger: sock.logger, messageId: id, ...genOptions })
      message = full.message
    }

    const normalized = normalize(message)
    const mediaType = mediaTypeOf(normalized)
    if (!mediaType && (normalized?.documentMessage || normalized?.stickerMessage)) {
      throw new TypeError('Status saluran mendukung teks, gambar, video, gif, dan audio')
    }
    const interactionType = givenInteraction || (content.question ? 'question' : undefined)

    const node = buildStatusNode({
      jid, payload: encode(message), messageId: id, mediaType,
      mediaHandle: givenHandle ?? mediaId ?? uploadedHandle,
      parentServerId, responseServerId, interactionType, aiContent,
    })

    const echo = resolveServerId === false ? null : waitServerId({ jid, messageId: id, timeoutMs: serverIdTimeoutMs })
    let ack
    try {
      ack = await sendStatusNode(node, { jid, messageId: id, timeoutMs: ackTimeoutMs })
    } catch (e) {
      echo?.cancel()
      throw e
    }
    const delivered = echo ? await echo : undefined
    return {
      key: { remoteJid: jid, fromMe: true, id }, message, status: serverAck,
      newsletterStatusServerId: ack.serverId ?? delivered?.serverId,
      newsletterStatusAck: ack, newsletterStatusResponse: ack.node,
      ...(delivered ? { newsletterStatusDelivered: delivered.node } : {}),
    }
  }

  sock.sendNewsletterStatusReaction = async (jid, parentServerId, reaction, options = {}) => {
    assertNewsletter(jid)
    const id = options.messageId || generateMessageIDV2(me())
    const node = buildReactionNode({ jid, messageId: id, parentServerId, reaction })
    const ack = await sendStatusNode(node, { jid, messageId: id, timeoutMs: options.ackTimeoutMs })
    return { key: { remoteJid: jid, fromMe: true, id }, status: serverAck, newsletterStatusServerId: ack.serverId, newsletterStatusAck: ack, newsletterStatusResponse: ack.node }
  }

  sock.revokeNewsletterStatus = async (jid, statusId, options = {}) => {
    assertNewsletter(jid)
    me()
    const node = buildRevokeNode({ jid, statusId })
    const ack = await sendStatusNode(node, { jid, messageId: statusId, timeoutMs: options.ackTimeoutMs })
    return { key: { remoteJid: jid, fromMe: true, id: statusId }, status: serverAck, newsletterStatusAck: ack, newsletterStatusResponse: ack.node }
  }

  const decode = bytes => proto.Message.decode(bytes)

  sock.getNewsletterStatuses = async (jid, options = {}) => {
    assertNewsletter(jid)
    const { count = 20, before, after, viewRole } = options
    const attrs = { type: 'jid', jid }
    if (viewRole !== undefined && viewRole !== null && viewRole !== '') attrs.view_role = String(viewRole).toLowerCase()
    attrs.count = String(count)
    if (before !== undefined && before !== null && before !== '') attrs.before = toServerId(before, 'before')
    else if (after !== undefined && after !== null && after !== '') attrs.after = toServerId(after, 'after')
    const result = await sock.query({
      tag: 'iq', attrs: { to: S_WHATSAPP_NET, xmlns: 'newsletter', type: 'get' },
      content: [{ tag: 'statuses', attrs, content: undefined }],
    })
    return parseStatuses(result, decode)
  }

  sock.getNewsletterStatusUpdates = async (jid, options = {}) => {
    assertNewsletter(jid)
    const { count = 20, since, before, after } = options
    const attrs = { count: String(count) }
    if (since !== undefined && since !== null && since !== '') attrs.since = String(since)
    if (before !== undefined && before !== null && before !== '') attrs.before = toServerId(before, 'before')
    else if (after !== undefined && after !== null && after !== '') attrs.after = toServerId(after, 'after')
    const result = await sock.query({
      tag: 'iq', attrs: { to: jid, xmlns: 'newsletter', type: 'get' },
      content: [{ tag: 'status_updates', attrs, content: undefined }],
    })
    return parseStatusUpdates(result, decode)
  }

  return sock
}
