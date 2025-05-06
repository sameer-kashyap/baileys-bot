// index.js
import pkg from '@whiskeysockets/baileys'
const {
  default: makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion
} = pkg

import qrcode from 'qrcode-terminal'
import { createClient } from '@supabase/supabase-js'
import { useMultiFileAuthState } from '@whiskeysockets/baileys'

// ─── Supabase Setup ────────────────────────────────────────────────────────────
const supabaseUrl = process.env.SUPABASE_URL
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY
const supabase        = createClient(supabaseUrl, supabaseAnonKey)

// ─── Auth State Setup ─────────────────────────────────────────────────────────
const { state, saveCreds } = await useMultiFileAuthState('./auth_info')

// ─── Start the bot ────────────────────────────────────────────────────────────
async function startBot() {
  const { version, isLatest } = await fetchLatestBaileysVersion()
  console.log('Using WA v%s (latest: %s)', version.join('.'), isLatest)

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: true,
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', ({ connection, qr, lastDisconnect }) => {
    if (qr) qrcode.generate(qr, { small: true })

    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut
      console.log('Connection closed. Reconnecting?', shouldReconnect)
      if (shouldReconnect) startBot()
      else console.log('Logged out — delete auth_info to re-scan QR.')
    }

    if (connection === 'open') {
      console.log('✅ WhatsApp connected')
    }
  })

  // 🟡 Periodic check for due reminders
  setInterval(async () => {
    const { data: reminders, error } = await supabase
      .from('reminders')
      .select('*')
      .eq('status', 'pending')
      .lte('send_at', new Date().toISOString())

    if (error) {
      console.error('❌ Error fetching reminders:', error)
      return
    }

    for (const reminder of reminders) {
      try {
        const number = reminder.phone_number.replace(/\D/g, '') + '@s.whatsapp.net'
        await sock.sendMessage(number, { text: reminder.message })
        console.log('📤 Sent message to:', number)

        await supabase
          .from('reminders')
          .update({ status: 'sent', sent_at: new Date().toISOString() })
          .eq('id', reminder.id)

      } catch (err) {
        console.error('❌ Failed to send reminder:', err)
      }
    }
  }, 60 * 1000)

  // 🔁 Incoming messages logging (optional)
  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0]
    if (!msg.message) return

    const from = msg.key.remoteJid
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || ''

    console.log(`📥 ${from}: ${text}`)

    const { error } = await supabase
      .from('messages')
      .insert([{ sender: from, content: text }])

    if (error) console.error('❌ Supabase insert error:', error)
  })
}

startBot()