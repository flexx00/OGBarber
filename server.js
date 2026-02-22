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

// Load booked slots from file safely
function loadBookedSlots() {
    try {
        if(fs.existsSync(BOOKED_FILE)) {
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

// Save booked slots
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

// GET booked slots
app.get('/booked/:date', (req,res) => {
    loadBookedSlots(); // always reload from file
    const dateParam = new Date(req.params.date).toISOString().split('T')[0];
    const slots = bookedSlots
        .filter(s => s.date === dateParam)
        .map(s => s.time)
        .sort((a,b)=>{
            const [ah, am] = a.split(':').map(Number);
            const [bh, bm] = b.split(':').map(Number);
            return ah-bh || am-bm;
        });
    res.json(slots);
});

// POST /book
app.post('/book', async (req,res) => {
    const booking = req.body;
    if(!booking.name || !booking.date || !booking.time || !booking.services || !booking.total)
        return res.status(400).json({ ok:false, error:"Missing booking fields" });

    loadBookedSlots(); // reload latest before checking
    removePastBookings();

    const bookingDate = new Date(booking.date).toISOString().split('T')[0];
    const bookingTime = booking.time;

    // Prevent duplicates
    const exists = bookedSlots.some(s => s.date===bookingDate && s.time===bookingTime);
    if(exists) return res.status(400).json({ ok:false, error:"Slot already booked" });

    bookedSlots.push({ date: bookingDate, time: bookingTime });
    saveBookedSlots();

    try {
        const { default: fetch } = await import('node-fetch');
        await fetch(DISCORD_WEBHOOK, {
            method:"POST",
            headers:{ "Content-Type":"application/json" },
            body: JSON.stringify({
                embeds:[{
                    title:"New Booking",
                    description:`**Name:** ${booking.name}\n**Date:** ${bookingDate}\n**Time:** ${bookingTime}\n**Services:** ${booking.services.join(", ")}\n**Total:** £${booking.total}`,
                    color:16753920
                }]
            })
        });
        res.json({ ok:true });
    } catch(err){
        console.error(err);
        res.status(500).json({ ok:false, error:err.message });
    }
});

const PORT = 5000;
app.listen(PORT,'0.0.0.0', ()=>console.log(`Booking server running on port ${PORT}`));