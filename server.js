const express = require("express");
const fs = require("fs");
const bodyParser = require("body-parser");
const app = express();

app.use(bodyParser.json());
app.use(express.static("public"));

const BOOKINGS_FILE = "bookings.json";

function readBookings() {
    if (!fs.existsSync(BOOKINGS_FILE)) return [];
    return JSON.parse(fs.readFileSync(BOOKINGS_FILE));
}

function saveBookings(bookings) {
    fs.writeFileSync(BOOKINGS_FILE, JSON.stringify(bookings, null, 2));
}

app.post("/book", (req, res) => {
    const { date, time, services, total } = req.body;

    let bookings = readBookings();

    // 🚫 Prevent double booking
    const alreadyBooked = bookings.find(
        b => b.date === date && b.time === time
    );

    if (alreadyBooked) {
        return res.status(400).json({ message: "Time slot already booked." });
    }

    const newBooking = {
        id: Date.now(),
        date,
        time,
        services,
        total
    };

    bookings.push(newBooking);
    saveBookings(bookings);

    res.json({ message: "Booking confirmed!", booking: newBooking });
});

app.get("/bookings", (req, res) => {
    res.json(readBookings());
});

app.listen(3000, () => {
    console.log("Server running on http://localhost:3000");
});