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
const supabaseUrl     = 'https://bwfmzqktiocbhrsmxvvi.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ3Zm16cWt0aW9jYmhyc214dnZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDYyNDc4MjYsImV4cCI6MjA2MTgyMzgyNn0.Uut5SCy2SsUdddA-IuKd1F8hvIC9f9-SHmVCLD2_XrQ'  // Replace with your actual key
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

//bailey bot error fix 

const application = express();

application.get('/', (req, res) => {
  res.send('Baileys bot is running.');
});

const PORTING = process.env.PORT || 3000;
app.listen(PORTING, () => {
  console.log(`Web server running on port ${PORTING}`);
});

startBot()