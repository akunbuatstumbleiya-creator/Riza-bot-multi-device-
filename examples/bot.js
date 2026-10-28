import { startRiza, parseCommand } from '@riza/baileys'

await startRiza({
  session: 'session',
  autoRead: true,
  onOpen: () => console.log('Riza connected!'),
  onClose: ({ loggedOut }) => loggedOut && process.exit(0),

  async onMessage(m, sock) {
    if (m.fromMe) return
    const c = parseCommand(m.body)
    if (!c) return

    switch (c.command) {
      case 'ping':
        return m.reply('Pong!')

      case 'react':
        return m.react('🔥')

      case 's': { // stiker dari gambar/video
        const media = m.media
        if (!media) return m.reply('Kirim/balas gambar atau video.')
        return sock.sendSticker(m.chat, await media.download(), m, { pack: 'Riza', author: 'Riza' })
      }

      case 'btn':
        return sock.sendButtons(m.chat, {
          title: 'Riza', body: 'Pilih salah satu', footer: 'Riza Baileys',
          buttons: [{ id: '.ping', text: 'Ping' }, { id: '.react', text: 'React' }],
        }, m)

      case 'list':
        return sock.sendList(m.chat, {
          title: 'Menu', body: 'Pilih menu', buttonText: 'Buka',
          sections: [{ title: 'Utama', rows: [{ title: 'Ping', description: 'Cek bot', id: '.ping' }] }],
        }, m)

      case 'poll':
        return sock.sendPoll(m.chat, 'Suka bot ini?', ['Ya', 'Banget'], 1, m)

      case 'admin':
        return m.reply((await sock.isAdmin(m.chat, m.sender)) ? 'Kamu admin' : 'Kamu bukan admin')
    }
  },

  async onGroupParticipants({ id, participants, action }, sock) {
    if (action === 'add')
      for (const p of participants) {
        const jid = typeof p === 'string' ? p : p.phoneNumber || p.id
        await sock.sendMention(id, `Selamat datang @${jid.split('@')[0]}!`, [jid])
      }
  },
})
