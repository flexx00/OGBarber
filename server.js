const express = require("express");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcrypt");
const cors = require("cors");

const app = express();
const PORT = 3000;
const CLIENTS_FILE = path.join(__dirname, "clients.txt");

app.use(cors());
app.use(express.json());

function validateEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

app.post("/signup", async (req, res) => {
  try {
    const { fullName, email, phone, password, contactPreferences } = req.body;

    if (!fullName || !email || !password || !contactPreferences) {
      return res.status(400).json({ message: "Missing required fields." });
    }

    if (!validateEmail(email)) {
      return res.status(400).json({ message: "Invalid email format." });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters." });
    }

    // Optional phone: if present, simple validation for digits only (basic)
    if (phone && !/^\+?\d{7,15}$/.test(phone)) {
      return res.status(400).json({ message: "Invalid phone number format." });
    }

    // Hash password securely
    const hashedPassword = await bcrypt.hash(password, 10);

    // Prepare client data object to save (don't save plain password)
    const clientData = {
      fullName,
      email,
      phone: phone || null,
      passwordHash: hashedPassword,
      contactPreferences,
      createdAt: new Date().toISOString(),
    };

    // Append JSON string to clients.txt file (each client on separate line)
    fs.appendFile(CLIENTS_FILE, JSON.stringify(clientData) + "\n", (err) => {
      if (err) {
        console.error("Error writing client data:", err);
        return res.status(500).json({ message: "Internal server error." });
      }
      res.json({ message: "Signup successful." });
    });
  } catch (error) {
    console.error("Signup error:", error);
    res.status(500).json({ message: "Internal server error." });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});