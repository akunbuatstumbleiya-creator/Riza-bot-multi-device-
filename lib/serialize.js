const SKIP = ['messageContextInfo', 'senderKeyDistributionMessage']
const MEDIA = ['imageMessage', 'videoMessage', 'audioMessage', 'stickerMessage', 'documentMessage']

export const unwrap = m => {
  let x = m
  while (x?.ephemeralMessage || x?.viewOnceMessage || x?.viewOnceMessageV2 || x?.viewOnceMessageV2Extension || x?.documentWithCaptionMessage || x?.editedMessage) {
    x = (x.ephemeralMessage || x.viewOnceMessage || x.viewOnceMessageV2 || x.viewOnceMessageV2Extension || x.documentWithCaptionMessage || x.editedMessage).message
  }
  return x
}

export const contentType = msg => (msg ? Object.keys(msg).find(k => !SKIP.includes(k)) || '' : '')

export function getBody(msg) {
  const t = contentType(msg)
  const c = msg?.[t]
  if (!t) return ''
  if (t === 'conversation') return msg.conversation
  if (t === 'extendedTextMessage') return c.text || ''
  if (['imageMessage', 'videoMessage', 'documentMessage'].includes(t)) return c.caption || ''
  if (t === 'buttonsResponseMessage') return c.selectedButtonId || ''
  if (t === 'listResponseMessage') return c.singleSelectReply?.selectedRowId || ''
  if (t === 'templateButtonReplyMessage') return c.selectedId || ''
  if (t === 'interactiveResponseMessage') {
    try { return JSON.parse(c.nativeFlowResponseMessage.paramsJson).id || '' } catch { return '' }
  }
  return ''
}

// Ubah pesan mentah Baileys jadi objek siap pakai untuk bot
export function serialize(sock, m) {
  if (!m?.key) return m
  const dec = j => sock.decodeJid(j)
  const out = { raw: m, key: m.key, id: m.key.id, fromMe: !!m.key.fromMe, pushName: m.pushName || '' }
  out.chat = dec(m.key.remoteJid)
  out.isGroup = out.chat?.endsWith('@g.us')
  out.timestamp = Number(m.messageTimestamp || 0)

  let sender = out.isGroup ? m.key.participant || m.participant : m.key.fromMe ? sock.user?.id : out.chat
  sender = dec(sender)
  const alt = m.key.participantAlt || m.key.remoteJidAlt
  out.senderRaw = sender
  if (sender?.endsWith('@lid') && alt) sender = dec(alt)
  out.sender = sender
  out.number = (sender || '').split('@')[0]

  const message = unwrap(m.message)
  out.message = message
  out.type = contentType(message)
  const content = message?.[out.type]
  out.body = getBody(message)
  out.mimetype = content?.mimetype || ''
  out.isMedia = MEDIA.includes(out.type)
  const ci = content?.contextInfo
  out.mentions = ci?.mentionedJid || []
  out.expiration = ci?.expiration || 0

  if (ci?.quotedMessage) {
    const qm = unwrap(ci.quotedMessage)
    const qs = dec(ci.participant)
    const qt = contentType(qm)
    const key = { remoteJid: out.chat, fromMe: qs === dec(sock.user?.id), id: ci.stanzaId, participant: ci.participant }
    out.quoted = {
      key, id: ci.stanzaId, sender: qs, message: qm, type: qt,
      body: getBody(qm), mimetype: qm?.[qt]?.mimetype || '',
      isMedia: MEDIA.includes(qt),
      download: () => sock.downloadMedia({ key, message: qm }),
      delete: () => sock.deleteMessage(out.chat, key),
    }
  } else out.quoted = null

  // aksi cepat
  out.reply = (text, extra) => sock.sendText(out.chat, text, m, extra)
  out.react = emoji => sock.sendReact(out.chat, m.key, emoji)
  out.download = () => sock.downloadMedia({ key: m.key, message })
  out.delete = () => sock.deleteMessage(out.chat, m.key)
  out.forward = (jid, opts) => sock.forward(jid, m, opts)
  out.send = (content, opts) => sock.sendMessage(out.chat, content, { quoted: m, ...opts })
  // media yang dikirim langsung atau dari pesan yang di-reply
  out.media = out.isMedia ? out : out.quoted?.isMedia ? out.quoted : null
  return out
}
