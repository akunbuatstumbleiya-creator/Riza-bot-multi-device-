# @riza/baileys

Lapisan di atas `@whiskeysockets/baileys` supaya bikin bot WhatsApp MD jauh lebih singkat.
Semua export asli Baileys tetap ada, ditambah helper khusus bot MD.

## Install
```bash
npm i github:akunbuatstumbleiya-creator/Riza-bot-multi-device-
```
Tanpa build, langsung jadi. Baileys asli ikut terpasang otomatis dari npm sebagai dependency (tidak disalin ke repo ini).
Node.js 18+. Untuk stiker animasi butuh `ffmpeg`.

## Mulai cepat
```js
import { startRiza, parseCommand } from '@riza/baileys'

await startRiza({
  session: 'session',
  pairingNumber: '',              // kosong = ditanya di terminal
  async onMessage(m, sock) {
    const c = parseCommand(m.body)
    if (c?.command === 'ping') m.reply('Pong!')
  },
})
```
Lihat `examples/bot.js` untuk contoh lengkap (stiker, tombol, list, poll, cek admin, welcome).

## startRiza(opts)
Auth, pairing code, auto reconnect, store, dan serialize pesan sudah diurus.
| Opsi | Fungsi |
|---|---|
| `session` | folder sesi (default `session`) |
| `pairingNumber` | nomor bot untuk pairing code |
| `autoRead` | tandai pesan dibaca otomatis |
| `autoReconnect` | sambung ulang otomatis (default true) |
| `socketConfig` | opsi tambahan untuk socket Baileys |
| `onSocket(sock)` | tiap socket baru dibuat (termasuk setelah reconnect) |
| `onMessage(m, sock)` | pesan masuk yang sudah di-serialize |
| `onOpen(sock)`, `onClose({code, loggedOut})` | status koneksi |
| `onGroupParticipants(update, sock)`, `onCall(calls, sock)` | event grup dan panggilan |

Mau kontrol penuh? Pakai `makeRizaSocket(config)` (socket + store, tanpa auth/reconnect otomatis).

## Objek pesan `m`
`chat, sender, number, pushName, isGroup, fromMe, type, body, mentions, mimetype, isMedia, timestamp, key, raw`
- `m.quoted` : `{ key, sender, type, body, mimetype, isMedia, download(), delete() }` atau `null`
- `m.media` : pesan media sendiri atau dari reply (praktis untuk stiker/tourl)
- Aksi: `m.reply(text)`, `m.react(emoji)`, `m.download()`, `m.delete()`, `m.forward(jid)`, `m.send(content)`
- `sender` sudah otomatis dikonversi dari LID ke nomor kalau datanya tersedia.
- Balasan tombol/list otomatis masuk ke `m.body` (berisi `id` tombolnya), jadi bisa dipakai sebagai command.

## Method tambahan di `sock`
Kirim: `sendText, sendMention, sendFile (auto tipe), sendImage, sendVideo, sendAudio, sendDocument, sendSticker, sendContact, sendLocation, sendReact, sendPoll`
Kelola: `deleteMessage, editMessage, forward, downloadMedia`
Interaktif: `sendButtons, sendUrlButton, sendCopyButton, sendList, sendInteractive`
Data: `decodeJid, botJid, getGroup, getName, isAdmin, parseMention`
Sumber file boleh Buffer, URL, data URI, atau path lokal.

## Kompatibilitas dengan SC yang dibuat untuk fork lain
- `sock.findUserId(jid)`: cari pasangan LID dan nomor. Hasil `{ lid, jid, phoneNumber }` atau `null`.
  Datanya dipelajari otomatis dari pesan, kontak, dan daftar peserta grup, lalu dilengkapi pemetaan LID bawaan Baileys 7.
- Channel Status (status di saluran), nama dan bentuk hasilnya sama dengan Elaina:
  `newsletterCanPostStatus(jid)`, `sendNewsletterStatus(jid, content, options)`,
  `getNewsletterStatuses(jid, { count, before, after, viewRole })`,
  `getNewsletterStatusUpdates(jid, { count, since, before, after })`,
  `sendNewsletterStatusReaction(jid, serverId, reaction)`, `revokeNewsletterStatus(jid, statusId)`.
  Cek `sock.channelStatusSupported`: `true` kalau Baileys yang terpasang punya `waitForMessage`, `sendNode`, dan `refreshMediaConn` (Baileys 7).
  Kalau `false`, metodenya tetap ada tapi melempar error yang jelas.
  Contoh: `await sock.sendNewsletterStatus(jid, { text: 'Halo' })` atau `{ image: buffer, caption: '...' }`.

## Helper
`parseCommand(body, prefixes)`, `getFile(source)`, `detectType(buffer)`, `parseMention`, `formatSize`, `toJid`, `numberOf`, `sleep`, `makeStore`, `serialize`.

## Catatan
- Pesan interaktif (tombol/list) itu fitur tidak resmi WhatsApp; tampilannya bisa berbeda atau tidak muncul di sebagian versi WhatsApp.
- Ini lapisan (wrapper), bukan salinan source Baileys. Jadi update Baileys tinggal `npm update`.
- Semua helper juga tersedia lewat `Riza.*` (contoh `Riza.parseCommand`) dan sebagai export biasa.
- Channel Status ditulis ulang untuk Riza berdasarkan protokol yang dipelajari dari `@rexxhayanasi/elaina-baileys` (MIT). Terima kasih kepada penulisnya.
- Channel Status belum pernah dites ke server WhatsApp asli, hanya ke socket tiruan. Kalau ada yang ditolak server, kirim pesan errornya.
- Baileys adalah milik WhiskeySockets (MIT). Repo ini hanya memakainya sebagai dependency.
