// findUserId: cari pasangan LID <-> nomor telepon untuk sebuah JID
// Hasil: { lid, jid, phoneNumber } atau null kalau tidak ketemu
const isLid = j => typeof j === 'string' && j.endsWith('@lid')
const isPn = j => typeof j === 'string' && j.endsWith('@s.whatsapp.net')
const norm = j => (typeof j === 'string' ? j.replace(/:\d+@/, '@') : '')

export function makeIdentity(store, sock) {
  async function findUserId(input) {
    if (!input) return null
    let jid = norm(String(input))
    if (!jid.includes('@')) jid = jid.replace(/\D/g, '') + '@s.whatsapp.net'

    let lid, pn
    if (isLid(jid)) { lid = jid; pn = store.lidToPn.get(jid) }
    else if (isPn(jid)) { pn = jid; lid = store.pnToLid.get(jid) }
    else return null // grup, saluran, dll

    // kalau belum ada di store, tanya pemetaan LID bawaan Baileys 7
    const map = sock.signalRepository?.lidMapping
    try {
      if (lid && !pn) {
        const r = await map?.getPNForLID(lid)
        if (r) pn = norm(r.includes('@') ? r : r + '@s.whatsapp.net')
      } else if (pn && !lid) {
        const r = await map?.getLIDForPN(pn)
        if (r) lid = norm(r.includes('@') ? r : r + '@lid')
      }
    } catch {}

    if (lid && pn) store.learnPair(lid, pn)
    if (!lid && !pn) return null
    return { lid: lid || null, jid: pn || null, phoneNumber: pn || null }
  }
  return { findUserId }
}
