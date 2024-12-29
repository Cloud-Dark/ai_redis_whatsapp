require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const axios = require('axios');
const redis = require('./config/redis');
const fs = require('fs');

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info'); // Sesi WhatsApp di root folder
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: true,
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const isBoomError = lastDisconnect?.error?.isBoom;
            const shouldReconnect = !isBoomError || lastDisconnect.error.output.statusCode !== 401;

            console.log('Koneksi terputus. Reconnect:', shouldReconnect);
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log('Bot berhasil terhubung!');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type === 'notify' && messages[0]?.message) {
            const msg = messages[0];
            const senderNumber = msg.key.remoteJid;
            const text = msg.message.conversation || '';

            console.log(`Pesan diterima dari ${senderNumber}: ${text}`);

            if (text) {
                try {
                    // Kirim status "typing..." ke WhatsApp
                    await sock.sendPresenceUpdate('composing', senderNumber);

                    // Ambil riwayat chat dari Redis
                    let chatHistory = await redis.get(senderNumber);
                    chatHistory = chatHistory ? JSON.parse(chatHistory) : [];

                    // Tambahkan pesan pengguna ke riwayat
                    chatHistory.push({ role: 'user', content: text, timestamp: new Date().toISOString() });

                    // Kirim pesan ke AI
                    const aiResponse = await processWithAI(chatHistory);

                    // Tambahkan respons AI ke riwayat
                    chatHistory.push({ role: 'assistant', content: aiResponse, timestamp: new Date().toISOString() });

                    // Simpan riwayat kembali ke Redis
                    await redis.set(senderNumber, JSON.stringify(chatHistory), 'EX', 10800);

                    // Kirim respons ke WhatsApp
                    await sock.sendMessage(senderNumber, { text: aiResponse });

                    // Hapus status "typing..."
                    await sock.sendPresenceUpdate('paused', senderNumber);
                } catch (error) {
                    console.error('Terjadi kesalahan:', error.message);
                    await sock.sendMessage(senderNumber, {
                        text: 'Maaf, terjadi kesalahan saat memproses permintaan Anda.',
                    });
                }
            }
        }
    });
}

// Fungsi untuk memproses dengan AI
async function processWithAI(chatHistory) {
    const systemPrompt = 'Kamu adalah asisten pribadi yang membantu percakapan berbasis teks.';
    const messages = [
        { role: 'system', content: systemPrompt },
        ...chatHistory,
    ];

    const aiUrl = process.env.AI_API_URL;
    if (!aiUrl || !/^https?:\/\/.+/i.test(aiUrl)) {
        throw new Error('AI_API_URL tidak valid. Periksa konfigurasi .env Anda.');
    }

    const options = {
        method: 'POST',
        url: aiUrl,
        headers: {
            Authorization: `Bearer ${process.env.AI_API_TOKEN}`, // Token dari ENV
            'Content-Type': 'application/json',
        },
        data: { messages },
    };

    try {
        const response = await axios(options);
        const aiResponse = response.data?.result?.response || 'AI tidak memberikan respons yang valid.';
        return aiResponse.trim();
    } catch (error) {
        console.error('Gagal memproses AI:', error.response?.data || error.message);
        throw new Error('Gagal memproses permintaan AI.');
    }
}

// Jalankan bot
startBot().catch((err) => console.error('Terjadi kesalahan:', err));
