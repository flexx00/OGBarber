// server.js
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const app = express();

// Middleware
app.use(cors());
app.use(express.json());

const DISCORD_WEBHOOK = "https://canary.discord.com/api/webhooks/1475119321020760256/nrO83jn0qfozhrb_iim7bFcjqgeD3UCG9s4JPaDCSo-05vhE3ylboPVNKVlUtDxjB8sa";
const BOOKED_FILE = path.join(__dirname, 'bookedSlots.json');

// Global bookedSlots array
let bookedSlots = [];

// Load booked slots from file
function loadBookedSlots() {
    try {
        if (fs.existsSync(BOOKED_FILE)) {
            const data = fs.readFileSync(BOOKED_FILE, 'utf-8').trim();
            bookedSlots = data ? JSON.parse(data) : [];
        } else {
            bookedSlots = [];
        }
    } catch (err) {
        console.error("Failed to read booked slots file:", err);
        bookedSlots = [];
    }
}

// Save booked slots to file
function saveBookedSlots() {
    fs.writeFileSync(BOOKED_FILE, JSON.stringify(bookedSlots, null, 2));
}

// Remove past bookings
function removePastBookings() {
    const today = new Date().toISOString().split('T')[0];
    bookedSlots = bookedSlots.filter(slot => slot.date >= today);
    saveBookedSlots();
}

// Initial load
loadBookedSlots();
removePastBookings();


// GET booked slots for a specific date
app.get('/booked/:date', (req, res) => {
    loadBookedSlots(); // always reload latest
    const dateParam = new Date(req.params.date).toISOString().split('T')[0];
    const slots = bookedSlots
        .filter(s => s.date === dateParam)
        .map(s => s.time)
        .sort((a, b) => {
            const [ah, am] = a.split(':').map(Number);
            const [bh, bm] = b.split(':').map(Number);
            return ah - bh || am - bm;
        });
    res.json(slots);
});


// POST /book a new slot
app.post('/book', async (req, res) => {
    const booking = req.body; 
    // booking should have { name, date, time, services, total }

    if (!booking.date || !booking.time || !booking.name) {
        return res.status(400).json({ ok: false, error: "Missing booking info" });
    }

    loadBookedSlots();
    removePastBookings();

    const bookingDate = new Date(booking.date).toISOString().split('T')[0];
    const bookingTime = booking.time;

    // Prevent double booking
    const exists = bookedSlots.some(s => s.date === bookingDate && s.time === bookingTime);
    if (exists) return res.status(400).json({ ok: false, error: "Slot already booked" });

    bookedSlots.push({ date: bookingDate, time: bookingTime });
    saveBookedSlots();

    // Send to Discord webhook
    try {
        const { default: fetch } = await import('node-fetch');
        await fetch(DISCORD_WEBHOOK, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                embeds: [{
                    title: "New Booking",
                    description: `**Name:** ${booking.name}\n**Date:** ${bookingDate}\n**Time:** ${bookingTime}\n**Services:** ${booking.services?.join(", ") || "None"}\n**Total:** £${booking.total || 0}`,
                    color: 16753920
                }]
            })
        });
        res.json({ ok: true, date: bookingDate, time: bookingTime });
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, error: err.message });
    }
});


const PORT = 5000;
app.listen(PORT, '0.0.0.0', () => console.log(`Booking server running on port ${PORT}`));