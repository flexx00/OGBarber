// server.js
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Discord webhook URL
const DISCORD_WEBHOOK = "https://canary.discord.com/api/webhooks/1475119321020760256/nrO83jn0qfozhrb_iim7bFcjqgeD3UCG9s4JPaDCSo-05vhE3ylboPVNKVlUtDxjB8sa";

// Helper to use node-fetch dynamically
async function fetchWrapper(...args) {
    const { default: fetch } = await import('node-fetch');
    return fetch(...args);
}

// Path to store booked slots
const BOOKED_FILE = path.join(__dirname, 'bookedSlots.json');

// Load booked slots from file or initialize empty array
let bookedSlots = [];
if (fs.existsSync(BOOKED_FILE)) {
    try {
        const data = fs.readFileSync(BOOKED_FILE, 'utf-8');
        bookedSlots = JSON.parse(data);
    } catch (err) {
        console.error("Failed to read booked slots file:", err);
        bookedSlots = [];
    }
}

// Save booked slots to file
function saveBookedSlots() {
    fs.writeFileSync(BOOKED_FILE, JSON.stringify(bookedSlots, null, 2));
}

// Remove past bookings (date before today)
function removePastBookings() {
    const today = new Date().toISOString().split('T')[0]; // yyyy-mm-dd
    bookedSlots = bookedSlots.filter(slot => slot.date >= today);
    saveBookedSlots();
}

// Call this on server start to clean old bookings
removePastBookings();

// GET route for browser check
app.get('/', (req, res) => res.send("Booking server is running"));

// GET booked slots for a specific date
app.get('/booked/:date', (req, res) => {
    // Normalize date to ISO (YYYY-MM-DD)
    const dateParam = new Date(req.params.date).toISOString().split('T')[0];

    let slots = bookedSlots
        .filter(slot => slot.date === dateParam)
        .map(slot => slot.time);

    // Sort times ascending
    slots.sort((a, b) => {
        const [ah, am] = a.split(':').map(Number);
        const [bh, bm] = b.split(':').map(Number);
        return ah - bh || am - bm;
    });

    res.json(slots);
});

// POST /book route
app.post('/book', async (req, res) => {
    const booking = req.body;

    // Validate required fields
    if (!booking.name || !booking.date || !booking.time || !booking.services || !booking.total) {
        return res.status(400).json({ ok: false, error: "Missing booking fields" });
    }

    // Normalize date
    const bookingDate = new Date(booking.date).toISOString().split('T')[0];
    const bookingTime = booking.time;

    // Remove old bookings before checking
    removePastBookings();

    // Check if slot is already booked
    const alreadyBooked = bookedSlots.some(slot => slot.date === bookingDate && slot.time === bookingTime);
    if (alreadyBooked) {
        return res.status(400).json({ ok: false, error: "Slot already booked" });
    }

    // Add slot to booked slots and save
    bookedSlots.push({ date: bookingDate, time: bookingTime });
    saveBookedSlots();

    try {
        // Send booking to Discord webhook
        await fetchWrapper(DISCORD_WEBHOOK, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                embeds: [{
                    title: "New Booking",
                    description: `**Name:** ${booking.name}\n**Date:** ${bookingDate}\n**Time:** ${bookingTime}\n**Services:** ${booking.services.join(", ")}\n**Total:** £${booking.total}`,
                    color: 16753920
                }]
            })
        });

        res.json({ ok: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// Start server, 0.0.0.0 allows external access
const PORT = 5000;
app.listen(PORT, '0.0.0.0', () => console.log(`Booking server running on port ${PORT}`));