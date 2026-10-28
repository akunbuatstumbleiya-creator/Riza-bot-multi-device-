// Store ringan di memori: kontak, metadata grup, dan cache pesan
export function makeStore({ maxMessages = 300 } = {}) {
  const contacts = {}
  const groups = {}
  const messages = new Map()
  const lidToPn = new Map()
  const pnToLid = new Map()

  const clean = j => (typeof j === 'string' ? j.replace(/:\d+@/, '@') : '')
  // simpan pasangan LID <-> nomor, urutan a/b bebas
  const learnPair = (a, b) => {
    a = clean(a); b = clean(b)
    const lid = [a, b].find(x => x.endsWith('@lid'))
    const pn = [a, b].find(x => x.endsWith('@s.whatsapp.net'))
    if (lid && pn) { lidToPn.set(lid, pn); pnToLid.set(pn, lid) }
  }
  const learnGroup = g => (g?.participants || []).forEach(p => learnPair(p.id, p.phoneNumber || p.jid || p.lid))

  const merge = c => {
    if (!c?.id) return
    contacts[c.id] = { ...contacts[c.id], ...c }
    learnPair(c.id, c.lid)
    learnPair(c.id, c.phoneNumber)
  }

  const bind = ev => {
    ev.on('contacts.upsert', list => list.forEach(merge))
    ev.on('contacts.update', list => list.forEach(merge))
    ev.on('groups.upsert', list => list.forEach(g => { groups[g.id] = g; learnGroup(g) }))
    ev.on('groups.update', list => list.forEach(u => u.id && (groups[u.id] = { ...groups[u.id], ...u })))
    ev.on('group-participants.update', ({ id }) => { delete groups[id] })
    ev.on('messages.upsert', ({ messages: list }) => {
      for (const m of list) {
        const jid = m.key?.remoteJid
        if (!jid) continue
        learnPair(m.key.participant, m.key.participantAlt)
        learnPair(m.key.remoteJid, m.key.remoteJidAlt)
        const arr = messages.get(jid) || []
        arr.push(m)
        if (arr.length > maxMessages) arr.shift()
        messages.set(jid, arr)
        const who = m.key.participant || (m.key.fromMe ? null : jid)
        if (who && m.pushName) merge({ id: who, notify: m.pushName })
      }
    })
  }

  const loadMessage = (jid, id) => (messages.get(jid) || []).find(m => m.key.id === id)
  return { contacts, groups, messages, lidToPn, pnToLid, learnPair, learnGroup, bind, loadMessage }
}
