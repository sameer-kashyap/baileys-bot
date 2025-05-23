import pkg from '@whiskeysockets/baileys'
const {
  default: makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion
} = pkg

import express from 'express'
import qrcode from 'qrcode-terminal'
import { createClient } from '@supabase/supabase-js'
import { useMultiFileAuthState } from '@whiskeysockets/baileys'

// ─── Express Setup ────────────────────────────────────────────────────────────
const app = express()
const PORT = process.env.PORT || 8080

app.get('/', (req, res) => {
  res.send('✅ Baileys bot is running!')
})

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`)
})

// ─── Supabase Setup ────────────────────────────────────────────────────────────
const supabaseUrl     = 'https://zpzwkdhfhfrdtcbwimbc.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpwendrZGhmaGZyZHRjYndpbWJjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDY3NzUwMzksImV4cCI6MjA2MjM1MTAzOX0.CexMgQ17b-tEd0s5V12N77ha5e8dIzvikKOms5nhOyo'
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

  // 🔁 Process scheduled reminders from 'reminders' table
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
  }, 60 * 1000) // every minute

  // 🔁 Dues reminder from 'members' table (every 4 hours)
  setInterval(async () => {
    const { data: members, error } = await supabase
      .from('members')
      .select('id, full_name, phone, due')
      .gt('due', 0)

    if (error) {
      console.error('❌ Error fetching due members:', error)
      return
    }

    for (const member of members) {
      try {
        const number = member.phone.replace(/\D/g, '') + '@s.whatsapp.net'
        const message = `Hi ${member.full_name}, you have ₹${member.due} pending at MM Fitness. Kindly clear it soon. Thank you! 💪`

        await sock.sendMessage(number, { text: message })
        console.log(`📤 Sent due reminder to ${member.full_name}: ₹${member.due}`)
      } catch (err) {
        console.error('❌ Failed to send due reminder:', err)
      }
    }
  }, 4 * 60 * 60 * 1000) // every 4 hours

  // 🔁 Log incoming messages to Supabase
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