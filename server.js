// server.js
const express = require('express');
const cors = require('cors');
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

// GET route for browser check
app.get('/', (req, res) => res.send("Booking server is running"));

// POST /book route
app.post('/book', async (req, res) => {
    const booking = req.body;
    console.log("Received booking:", booking);

    // Validate required fields
    if (!booking.name || !booking.date || !booking.time || !booking.services || !booking.total) {
        return res.status(400).json({ ok: false, error: "Missing booking fields" });
    }

    try {
        await fetchWrapper(DISCORD_WEBHOOK, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                embeds: [{
                    title: "New Booking",
                    description: `**Name:** ${booking.name}\n**Date:** ${booking.date}\n**Time:** ${booking.time}\n**Services:** ${booking.services.join(", ")}\n**Total:** £${booking.total}`,
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