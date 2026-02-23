const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const cron = require('node-cron');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const app = express();
app.use(cors());
app.use(express.json());

const PORT = 5000;
const DISCORD_WEBHOOK = "https://canary.discord.com/api/webhooks/1475119321020760256/nrO83jn0qfozhrb_iim7bFcjqgeD3UCG9s4JPaDCSo-05vhE3ylboPVNKVlUtDxjB8sa";

const BOOKED_FILE = path.join(__dirname, 'bookedSlots.json');
const USERS_FILE = path.join(__dirname, 'users.json');

let bookedSlots = [];
let users = [];

// ------------------ LOAD FILES ------------------
function loadBookedSlots() {
    if (!fs.existsSync(BOOKED_FILE)) fs.writeFileSync(BOOKED_FILE, "[]");
    bookedSlots = JSON.parse(fs.readFileSync(BOOKED_FILE, "utf8") || "[]");
}

function saveBookedSlots() {
    fs.writeFileSync(BOOKED_FILE, JSON.stringify(bookedSlots, null, 2));
}

function loadUsers() {
    if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, "[]");
    users = JSON.parse(fs.readFileSync(USERS_FILE, "utf8") || "[]");
}

function saveUsers() {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// ------------------ CLEAN PAST BOOKINGS ------------------
function removePastBookings() {
    const today = new Date().toISOString().split("T")[0];
    bookedSlots = bookedSlots.filter(b => b.date >= today);
    saveBookedSlots();
}

// ------------------ EMAIL SETUP ------------------
const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,  
    auth: {
        user: "bearwallbear1@gmail.com",
        pass: "qvut-ljig-nxbs-unqh" // 16-char App Password
    }
});

function sendEmail(to, subject, text) {
    transporter.sendMail({
        from: '"The OG Barber" <bearwallbear1@gmail.com>',
        to,
        subject,
        text
    }, (err, info) => {
        if(err) console.error("Email error:", err);
        else console.log("Email sent:", info.response);
    });
}

// ------------------ USER SIGNUP ------------------
app.post("/user/signup", async (req, res) => {
    loadUsers();
    const { email, username } = req.body;
    if (!email || !username) return res.status(400).json({ ok: false, error: "Missing info" });
    if (users.find(u => u.email === email)) return res.status(400).json({ ok: false, error: "Email already registered" });

    const user = { email, username };
    users.push(user);
    saveUsers();

    // Discord notification
    try {
        await fetch(DISCORD_WEBHOOK, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                embeds: [{
                    title: "📝 New User Signup",
                    description: `**Username:** ${username}\n**Email:** ${email}`,
                    color: 3447003
                }]
            })
        });
    } catch (err) { console.log("Discord webhook failed:", err.message); }

    res.json({ ok: true, user });
});

// ------------------ LOGIN ------------------
app.post("/user/login", (req, res) => {
    loadUsers();
    const { email } = req.body;
    const user = users.find(u => u.email === email);
    if (!user) return res.status(400).json({ ok: false, error: "User not found" });
    res.json({ ok: true, user });
});

// ------------------ GET BOOKED SLOTS ------------------
app.get("/booked/:date", (req, res) => {
    loadBookedSlots();
    const date = req.params.date;
    const slots = bookedSlots.filter(b => b.date === date).map(b => b.time);
    res.json(slots);
});

// ------------------ MAKE BOOKING ------------------
app.post("/book", async (req, res) => {
    loadBookedSlots();
    const { name, date, time, services, total, email } = req.body;
    if (!name || !date || !time || !email) return res.status(400).json({ ok: false, error: "Missing info" });

    removePastBookings();

    // Limit 1 booking per user per day
    const existingBooking = bookedSlots.find(b => b.date === date && b.email === email);
    if (existingBooking) return res.status(400).json({ ok: false, error: "You already have a booking on this day" });

    // Prevent double booking on the same slot
    const slotTaken = bookedSlots.some(b => b.date === date && b.time === time);
    if (slotTaken) return res.status(400).json({ ok: false, error: "Slot already booked" });

    bookedSlots.push({ name, date, time, services, total, email });
    saveBookedSlots();

    // Discord notification
    try {
        await fetch(DISCORD_WEBHOOK, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                embeds: [{
                    title: "📅 New Booking",
                    description:
                        `**Name:** ${name}\n` +
                        `**Date:** ${date}\n` +
                        `**Time:** ${time}\n` +
                        `**Services:** ${services?.join(", ") || "None"}\n` +
                        `**Total:** £${total || 0}`,
                    color: 16753920
                }]
            })
        });
    } catch (err) { console.log("Discord webhook failed:", err.message); }

    // Schedule reminders
    scheduleReminders({ name, date, time, email, services, total });

    res.json({ ok: true });
});

// ------------------ EMAIL REMINDERS ------------------
function scheduleReminders(booking) {
    const bookingDate = new Date(`${booking.date}T${booking.time}:00`);

    // 1 day before
    const dayBefore = new Date(bookingDate.getTime() - 24*60*60*1000);
    cron.schedule(`${dayBefore.getMinutes()} ${dayBefore.getHours()} ${dayBefore.getDate()} ${dayBefore.getMonth()+1} *`, () => {
        sendEmail(booking.email, "Reminder: Your Booking Tomorrow", 
            `Hi ${booking.name},\nYou have a booking for ${booking.services.join(", ")} on ${booking.date} at ${booking.time}.`);
    });

    // 1 hour before
    const hourBefore = new Date(bookingDate.getTime() - 60*60*1000);
    cron.schedule(`${hourBefore.getMinutes()} ${hourBefore.getHours()} ${hourBefore.getDate()} ${hourBefore.getMonth()+1} *`, () => {
        sendEmail(booking.email, "Reminder: Your Booking in 1 Hour",
            `Hi ${booking.name},\nYour booking for ${booking.services.join(", ")} is in 1 hour at ${booking.time}.`);
    });
}

// ------------------ START SERVER ------------------
loadBookedSlots();
removePastBookings();
loadUsers();

app.listen(PORT, () => console.log(`✅ Booking server running on port ${PORT}`));