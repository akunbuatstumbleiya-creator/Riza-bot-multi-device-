import fs from 'fs'
import * as ns from '@whiskeysockets/baileys'
import { getFile, parseMention } from './helpers.js'
import { makeIdentity } from './identity.js'
import { addChannelStatus } from './channel-status.js'

const B = k => ns[k] ?? ns.default?.[k]

// Tambahkan method siap pakai ke socket Baileys
export function extendSocket(sock, store, { logger } = {}) {
  const { proto, generateWAMessageFromContent, prepareWAMessageMedia, downloadMediaMessage, jidDecode } = {
    proto: B('proto'),
    generateWAMessageFromContent: B('generateWAMessageFromContent'),
    prepareWAMessageMedia: B('prepareWAMessageMedia'),
    downloadMediaMessage: B('downloadMediaMessage'),
    jidDecode: B('jidDecode'),
  }
  sock.store = store

  // ---------- identitas & data ----------
  sock.decodeJid = jid => {
    if (!jid) return jid
    if (/:\d+@/.test(jid)) {
      const d = jidDecode(jid)
      return d?.user && d?.server ? `${d.user}@${d.server}` : jid
    }
    return jid
  }
  sock.botJid = () => sock.decodeJid(sock.user?.id)
  sock.parseMention = parseMention
  sock.findUserId = makeIdentity(store, sock).findUserId
  addChannelStatus(sock)

  sock.getGroup = async (jid, fresh = false) => {
    if (!fresh && store.groups[jid]?.participants) return store.groups[jid]
    const meta = await sock.groupMetadata(jid)
    store.groups[jid] = meta
    store.learnGroup?.(meta)
    return meta
  }
  sock.getName = async jid => {
    jid = sock.decodeJid(jid)
    if (jid?.endsWith('@g.us')) return (await sock.getGroup(jid).catch(() => null))?.subject || jid
    if (jid === sock.botJid()) return sock.user?.name || 'bot'
    const c = store.contacts[jid]
    return c?.name || c?.notify || c?.verifiedName || (jid || '').split('@')[0]
  }
  sock.isAdmin = async (groupJid, userJid) => {
    const n = j => (j || '').split('@')[0].split(':')[0]
    const meta = await sock.getGroup(groupJid)
    const t = n(userJid)
    return meta.participants.some(p => p.admin && [p.id, p.phoneNumber, p.jid].filter(Boolean).map(n).includes(t))
  }

  // ---------- kirim pesan ----------
  const send = (jid, content, quoted, opts = {}) => sock.sendMessage(jid, content, { quoted, ...opts })

  sock.sendText = (jid, text, quoted, extra = {}) =>
    send(jid, { text, mentions: extra.mentions || parseMention(text), ...extra }, quoted)
  sock.sendMention = (jid, text, mentions, quoted) => send(jid, { text, mentions }, quoted)

  // kirim file otomatis sesuai tipe (gambar/video/audio/dokumen)
  sock.sendFile = async (jid, source, { caption, fileName, mimetype, asDocument, ptt, gif, sticker, quoted, ...extra } = {}) => {
    const f = await getFile(source)
    const mime = mimetype || f.mime
    let content
    if (asDocument) content = { document: f.buffer, mimetype: mime, fileName: fileName || `file.${f.ext}`, caption }
    else if (sticker && mime === 'image/webp') content = { sticker: f.buffer }
    else if (mime.startsWith('image/')) content = { image: f.buffer, caption }
    else if (mime.startsWith('video/')) content = { video: f.buffer, caption, gifPlayback: !!gif }
    else if (mime.startsWith('audio/')) content = { audio: f.buffer, mimetype: ptt ? 'audio/ogg; codecs=opus' : mime, ptt: !!ptt }
    else content = { document: f.buffer, mimetype: mime, fileName: fileName || `file.${f.ext}`, caption }
    return send(jid, { ...content, ...extra }, quoted)
  }
  sock.sendImage = async (jid, src, caption, quoted, extra) => send(jid, { image: (await getFile(src)).buffer, caption, ...extra }, quoted)
  sock.sendVideo = async (jid, src, caption, quoted, extra) => send(jid, { video: (await getFile(src)).buffer, caption, ...extra }, quoted)
  sock.sendAudio = async (jid, src, quoted, { ptt = false } = {}) => {
    const f = await getFile(src)
    return send(jid, { audio: f.buffer, mimetype: ptt ? 'audio/ogg; codecs=opus' : f.mime, ptt }, quoted)
  }
  sock.sendDocument = async (jid, src, fileName, quoted, extra) => {
    const f = await getFile(src)
    return send(jid, { document: f.buffer, mimetype: f.mime, fileName: fileName || `file.${f.ext}`, ...extra }, quoted)
  }
  sock.sendSticker = async (jid, src, quoted, { pack = 'Riza', author = 'Riza', type = 'full', quality = 70 } = {}) => {
    let Sticker
    try { ({ Sticker } = await import('wa-sticker-formatter')) } catch { throw new Error('Install dulu: npm i wa-sticker-formatter') }
    const st = new Sticker((await getFile(src)).buffer, { pack, author, type, quality })
    return send(jid, { sticker: await st.toBuffer() }, quoted)
  }
  sock.sendContact = (jid, list, quoted) => {
    const contacts = [].concat(list).map(c => ({
      vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:${c.name}\n${c.org ? `ORG:${c.org}\n` : ''}TEL;type=CELL;waid=${c.number}:+${c.number}\nEND:VCARD`,
    }))
    return send(jid, { contacts: { displayName: contacts.length > 1 ? `${contacts.length} kontak` : [].concat(list)[0].name, contacts } }, quoted)
  }
  sock.sendLocation = (jid, lat, lng, name, address, quoted) =>
    send(jid, { location: { degreesLatitude: lat, degreesLongitude: lng, name, address } }, quoted)
  sock.sendReact = (jid, key, emoji) => sock.sendMessage(jid, { react: { text: emoji, key } })
  sock.sendPoll = (jid, name, values, selectableCount = 1, quoted) =>
    send(jid, { poll: { name, values, selectableCount } }, quoted)

  // ---------- kelola pesan ----------
  sock.deleteMessage = (jid, key) => sock.sendMessage(jid, { delete: key })
  sock.editMessage = (jid, key, text) => sock.sendMessage(jid, { text, edit: key })
  sock.forward = (jid, message, { force = false, quoted } = {}) => send(jid, { forward: message, force }, quoted)
  sock.downloadMedia = async (m, file) => {
    const buf = await downloadMediaMessage(m, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage })
    if (file) fs.writeFileSync(file, buf)
    return buf
  }

  // ---------- pesan interaktif (native flow) ----------
  // Catatan: ini fitur tidak resmi, tampilannya bisa beda tergantung versi WhatsApp.
  sock.sendInteractive = async (jid, { title = '', body = '', footer = '', buttons = [], image, quoted } = {}) => {
    let header = { title, subtitle: '', hasMediaAttachment: false }
    if (image) {
      const media = await prepareWAMessageMedia({ image: (await getFile(image)).buffer }, { upload: sock.waUploadToServer })
      header = { title, subtitle: '', hasMediaAttachment: true, imageMessage: media.imageMessage }
    }
    const msg = generateWAMessageFromContent(
      jid,
      {
        viewOnceMessage: {
          message: {
            messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 },
            interactiveMessage: proto.Message.InteractiveMessage.create({
              body: { text: body }, footer: { text: footer }, header,
              nativeFlowMessage: { buttons, messageParamsJson: '' },
            }),
          },
        },
      },
      { quoted, userJid: sock.user?.id }
    )
    await sock.relayMessage(jid, msg.message, { messageId: msg.key.id })
    return msg
  }
  const btn = (name, params) => ({ name, buttonParamsJson: JSON.stringify(params) })

  // tombol balas cepat: buttons = [{ id, text }]
  sock.sendButtons = (jid, { buttons, ...o }, quoted) =>
    sock.sendInteractive(jid, { ...o, quoted, buttons: buttons.map(b => btn('quick_reply', { display_text: b.text, id: b.id })) })
  // tombol link
  sock.sendUrlButton = (jid, { text, url, ...o }, quoted) =>
    sock.sendInteractive(jid, { ...o, quoted, buttons: [btn('cta_url', { display_text: text, url, merchant_url: url })] })
  // tombol salin teks
  sock.sendCopyButton = (jid, { text, code, ...o }, quoted) =>
    sock.sendInteractive(jid, { ...o, quoted, buttons: [btn('cta_copy', { display_text: text, copy_code: code })] })
  // daftar pilihan: sections = [{ title, rows: [{ title, description, id }] }]
  sock.sendList = (jid, { buttonText = 'Pilih', sections, ...o }, quoted) =>
    sock.sendInteractive(jid, { ...o, quoted, buttons: [btn('single_select', { title: buttonText, sections })] })

  return sock
}
