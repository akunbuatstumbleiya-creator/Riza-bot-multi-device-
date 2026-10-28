// Channel Status: pembuat dan pembaca node XMPP (fungsi murni, tanpa Baileys).
// Format node dipelajari dari @rexxhayanasi/elaina-baileys (MIT), ditulis ulang untuk Riza.

const MEDIA = new Set(['audio', 'gif', 'image', 'video'])
const INTERACTIONS = new Set(['question', 'question_response', 'question_reshare'])
export const SERVER_ID_MIN = 99
export const SERVER_ID_MAX = 2147476647
export const EDIT_REACTION_REVOKE = '7'
export const EDIT_ADMIN_REVOKE = '8'

const has = v => v !== undefined && v !== null && v !== ''
const int = v => {
  if (!has(v)) return undefined
  const n = parseInt(String(v), 10)
  return Number.isFinite(n) ? n : undefined
}
export const isNewsletterJid = j => typeof j === 'string' && j.endsWith('@newsletter')

const kids = n => (Array.isArray(n?.content) ? n.content : [])
export const child = (n, tag) => kids(n).find(c => c?.tag === tag)
export const children = (n, tag) => kids(n).filter(c => c?.tag === tag)

export function assertNewsletter(jid) {
  if (!isNewsletterJid(jid)) throw new TypeError('Target Channel Status harus JID @newsletter')
}

export function toServerId(value, label = '') {
  const n = typeof value === 'number' ? value : Number(String(value).trim())
  if (!Number.isInteger(n) || n < SERVER_ID_MIN || n > SERVER_ID_MAX) {
    throw new TypeError(`${JSON.stringify(value)} bukan server id yang valid${label ? ` untuk ${label}` : ''} (${SERVER_ID_MIN}..${SERVER_ID_MAX})`)
  }
  return String(n)
}

// jenis media status dari isi pesan: image | video | gif | audio | undefined
export function mediaTypeOf(content) {
  if (content?.imageMessage) return 'image'
  if (content?.videoMessage) return content.videoMessage.gifPlayback ? 'gif' : 'video'
  if (content?.audioMessage) return 'audio'
  return undefined
}

function metaNode({ interactionType, parentServerId, responseServerId, aiContent }) {
  if (!interactionType && !aiContent) return undefined
  const attrs = {}
  if (interactionType) {
    attrs.interaction_type = interactionType
    if (interactionType === 'question_reshare') {
      if (!has(parentServerId) || !has(responseServerId)) throw new TypeError('question_reshare butuh parentServerId dan responseServerId')
      attrs.parent_server_id = toServerId(parentServerId, 'parentServerId')
      attrs.response_server_id = String(responseServerId)
    } else if (interactionType === 'question_response' && has(responseServerId)) {
      attrs.response_server_id = String(responseServerId)
    }
  }
  return { tag: 'meta', attrs, content: aiContent ? [{ tag: 'ai_content', attrs: {}, content: undefined }] : undefined }
}

export function buildStatusNode({ jid, payload, messageId, mediaType, mediaHandle, interactionType, parentServerId, responseServerId, aiContent }) {
  assertNewsletter(jid)
  if (!messageId) throw new TypeError('messageId wajib diisi')
  if (!(payload instanceof Uint8Array)) throw new TypeError('payload harus Uint8Array')
  if (mediaType && !MEDIA.has(mediaType)) throw new TypeError(`Tipe media status tidak didukung: ${mediaType}`)
  if (interactionType && !INTERACTIONS.has(interactionType)) throw new TypeError(`interactionType tidak didukung: ${interactionType}`)
  if (mediaType && !has(mediaHandle)) throw new TypeError('Status media butuh handle hasil upload')
  if (!mediaType && has(mediaHandle)) throw new TypeError('mediaId hanya untuk status media')
  if (interactionType === 'question_reshare' && !mediaType) throw new TypeError('question_reshare butuh media')
  if (interactionType === 'question_response') {
    if (mediaType) throw new TypeError('question_response dikirim sebagai status teks')
    if (!has(parentServerId)) throw new TypeError('question_response butuh parentServerId')
  }

  const attrs = { to: jid, id: messageId, type: mediaType ? 'media' : 'text' }
  if (mediaType) attrs.media_id = String(mediaHandle)
  if (interactionType === 'question_response') attrs.server_id = toServerId(parentServerId, 'parentServerId')

  const content = [{ tag: 'plaintext', attrs: mediaType ? { mediatype: mediaType } : {}, content: payload }]
  const meta = metaNode({ interactionType, parentServerId, responseServerId, aiContent })
  if (meta) content.push(meta)
  return { tag: 'status', attrs, content }
}

export function buildReactionNode({ jid, messageId, parentServerId, reaction }) {
  assertNewsletter(jid)
  if (!messageId) throw new TypeError('messageId wajib diisi')
  if (!has(parentServerId)) throw new TypeError('Reaksi status butuh parentServerId')
  const revoke = !has(reaction)
  const attrs = { to: jid, id: messageId, server_id: toServerId(parentServerId, 'parentServerId'), type: 'reaction' }
  if (revoke) attrs.edit = EDIT_REACTION_REVOKE
  return { tag: 'status', attrs, content: [{ tag: 'reaction', attrs: revoke ? {} : { code: reaction }, content: undefined }] }
}

export function buildRevokeNode({ jid, statusId }) {
  assertNewsletter(jid)
  if (!statusId) throw new TypeError('Revoke status butuh id status')
  return {
    tag: 'status',
    attrs: { to: jid, id: statusId, type: 'text', edit: EDIT_ADMIN_REVOKE },
    content: [{ tag: 'plaintext', attrs: {}, content: undefined }],
  }
}

// validasi <ack> dari server; lempar error kalau ditolak
export function parseAck(node, { jid, messageId } = {}) {
  const fail = (msg) => Object.assign(new Error(msg), { data: node })
  if (!node || node.tag !== 'ack') throw fail(`Channel Status mengharapkan <ack>, dapat <${node?.tag}>`)
  const a = node.attrs || {}
  if (a.class !== undefined && a.class !== 'status') throw fail(`Ack punya class "${a.class}", seharusnya "status"`)
  if (has(messageId) && has(a.id) && a.id !== messageId) throw fail(`Id ack tidak cocok: ${a.id} != ${messageId}`)
  if (has(jid) && has(a.from) && a.from !== jid) throw fail(`Asal ack tidak cocok: ${a.from} != ${jid}`)
  const ack = {
    class: a.class, from: a.from, id: a.id, t: int(a.t), serverId: int(a.server_id), edit: a.edit,
    error: has(a.error) ? String(a.error) : undefined,
    applicationError: int(a.application_error), backoff: int(a.backoff), node,
  }
  if (ack.error) {
    const detail = [ack.applicationError !== undefined && `application_error=${ack.applicationError}`, ack.backoff !== undefined && `backoff=${ack.backoff}`].filter(Boolean).join(', ')
    const hint = ['401', '403', 'not-authorized', 'forbidden'].includes(ack.error)
      ? '; saluran mungkin belum punya izin CHANNEL_STATUS_PRODUCER, cek newsletterCanPostStatus(jid)' : ''
    throw Object.assign(new Error(`Channel Status ditolak server (${ack.error})${detail ? ': ' + detail : ''}${hint}`), { data: ack })
  }
  return ack
}

function parseAdminProfile(meta) {
  const p = meta && child(meta, 'admin_profile')
  if (!p) return undefined
  const name = child(p, 'name')?.content
  const pic = child(p, 'picture')
  return {
    id: p.attrs?.id,
    name: typeof name === 'string' ? name : name instanceof Uint8Array ? Buffer.from(name).toString('utf-8') : undefined,
    pictureId: pic?.attrs?.id,
    pictureDirectPath: pic?.attrs?.direct_path,
  }
}

function parseStatus(status, decode) {
  const plaintext = child(status, 'plaintext')
  const reaction = child(status, 'reaction')
  const meta = child(status, 'meta')
  const reactions = child(status, 'reactions')
  let message
  const bytes = plaintext?.content
  if (decode && bytes && !Array.isArray(bytes)) {
    try { message = decode(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)) } catch {}
  }
  return {
    id: status.attrs?.id,
    serverId: int(status.attrs?.server_id),
    t: int(status.attrs?.t),
    isSender: status.attrs?.is_sender === 'true',
    type: status.attrs?.type,
    edit: status.attrs?.edit,
    mediaType: plaintext?.attrs?.mediatype,
    interactionType: meta?.attrs?.interaction_type,
    reaction: reaction ? reaction.attrs?.code ?? '' : undefined,
    adminProfile: parseAdminProfile(meta),
    paidPartnership: meta ? !!child(meta, 'paid_partnership') : false,
    aiContent: meta ? !!child(meta, 'ai_content') : false,
    editTimestamp: int(meta?.attrs?.msg_edit_t),
    originalTimestamp: int(meta?.attrs?.original_msg_t),
    reactionCounts: reactions ? children(reactions, 'reaction').map(e => ({ code: e.attrs?.code, count: int(e.attrs?.count) })) : undefined,
    viewsCount: int(child(status, 'views_count')?.attrs?.count),
    responsesCount: int(child(status, 'responses_count')?.attrs?.count),
    message,
    node: status,
  }
}

// hasil: { jid, t, statuses: [...] }
export function parseStatuses(node, decode) {
  const s = child(node, 'statuses')
  if (!s) throw Object.assign(new Error(`Respons tidak punya <statuses>, isinya [${kids(node).map(c => c?.tag).join(', ')}]`), { data: node })
  return { jid: s.attrs?.jid, t: int(s.attrs?.t), statuses: children(s, 'status').map(x => parseStatus(x, decode)) }
}

// hasil sama dengan parseStatuses, tapi dari <status_updates>
export function parseStatusUpdates(node, decode) {
  const u = child(node, 'status_updates')
  if (!u) throw Object.assign(new Error(`Respons tidak punya <status_updates>, isinya [${kids(node).map(c => c?.tag).join(', ')}]`), { data: node })
  return parseStatuses(u, decode)
}
