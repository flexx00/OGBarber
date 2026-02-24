// server.js - The OG Barber Booking Server
// Main entry point: config, middleware, DB, language, email, routes

import express from "express";
import cors from "cors";
import mysql from "mysql2/promise";
import nodemailer from "nodemailer";
import path from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";
import fs from "fs/promises";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 8080;  // ← your chosen port

// ─── MIDDLEWARE ────────────────────────────────────────────────────────────
app.use(cors({
  origin: [
    "http://localhost:5500",           // VS Code Live Server
    "http://127.0.0.1:5500",
    "http://localhost:3000",           // Vite/React dev server
    process.env.FRONTEND_URL || "*"    // Production domain from .env
  ],
  credentials: true,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json());
app.use(cookieParser());

// ─── ROOT ROUTE ────────────────────────────────────────────────────────────
// Added so http://192.168.0.8:8080/ shows something useful instead of "Cannot GET /"
app.get("/", (req, res) => {
  res.send(`
    <h1 style="text-align: center; color: #c9a347; font-family: 'Playfair Display', serif; margin-top: 50px;">
      The OG Barber Backend is Running!
    </h1>
    <p style="text-align: center; font-size: 1.2em; color: #f4f0e8;">
      Server online on port ${PORT}<br><br>
      <a href="/health" style="color: #e0c070;">Check health status</a><br>
      <a href="/test-email" style="color: #e0c070;">Test email sending</a>
    </p>
  `);
});

// ─── LOAD TRANSLATIONS ─────────────────────────────────────────────────────
let lang = {};

(async () => {
  try {
    const langPath = path.join(__dirname, "language.yaml");
    const fileContents = await fs.readFile(langPath, "utf8");
    lang = yaml.load(fileContents) || {};

    if (Object.keys(lang).length === 0) {
      console.warn("Translations file loaded but appears empty");
    } else {
      console.log(`Translations loaded successfully from ${langPath}`);
    }
  } catch (err) {
    console.error("Failed to load language.yaml:", err.message);
    lang = {}; // fallback — t() returns key
  }
})();

// ─── CONFIG ────────────────────────────────────────────────────────────────
export const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.error("JWT_SECRET is missing from .env file! Set it to a strong random value.");
  console.error("Example: JWT_SECRET=$(openssl rand -base64 48)");
  process.exit(1);
}

export const DISCORD_WEBHOOK = "https://canary.discord.com/api/webhooks/1475119321020760256/nrO83jn0qfozhrb_iim7bFcjqgeD3UCG9s4JPaDCSo-05vhE3ylboPVNKVlUtDxjB8sa";

export const ADMIN_EMAIL    = "admin@ogbarber.co.uk";
export const ADMIN_PASSWORD = "SuperSecret2026!";

export const LOGO_URL       = "https://i.imgur.com/4dIWLpI.jpeg";

// Nodemailer transporter (using .env values)
export const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS,
  },
  tls: {
    rejectUnauthorized: true,
    minVersion: "TLSv1.2"
  }
});

transporter.verify((error) => {
  if (error) {
    console.error("SMTP verification failed:", error.message);
  } else {
    console.log("SMTP connection ready");
  }
});

// ─── TRANSLATION HELPERS ───────────────────────────────────────────────────
export function t(section, key, fallback = null) {
  return lang?.[section]?.[key] ?? fallback ?? key;
}

export function tEmailSubject(key, fallback = null) {
  return lang?.email?.subjects?.[key] ?? fallback ?? key;
}

export function tEmailLabel(key, fallback = null) {
  return lang?.email?.labels?.[key] ?? fallback ?? key;
}

// ─── MYSQL POOL ────────────────────────────────────────────────────────────
export const pool = mysql.createPool({
  host: process.env.DB_HOST || "node1.infinityhosting.org",
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || "u26_uwHqsRd4bn",
  password: process.env.DB_PASSWORD || "WCI6m5n4hL3rYJxkPT@zHT3!",
  database: process.env.DB_NAME || "s26_the_og_barber",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  timezone: "Z",
  dateStrings: true,
});

// Initialize tables
(async () => {
  try {
    const conn = await pool.getConnection();
    console.log("MySQL connected");

    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        username VARCHAR(100) NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS bookings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        name VARCHAR(100) NOT NULL,
        date DATE NOT NULL,
        time TIME NOT NULL,
        services JSON NOT NULL,
        total DECIMAL(10,2) NOT NULL,
        email VARCHAR(255) NOT NULL,
        phone VARCHAR(20) DEFAULT NULL,
        status ENUM('pending', 'confirmed', 'completed', 'cancelled') DEFAULT 'pending',
        notes TEXT DEFAULT NULL,
        paid BOOLEAN DEFAULT FALSE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_slot (date, time),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_date (date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    conn.release();
  } catch (err) {
    console.error("MySQL setup failed:", err.message);
    process.exit(1);
  }
})();

// ─── ADMIN AUTH MIDDLEWARE ─────────────────────────────────────────────────
export function isAdmin(req, res, next) {
  const auth = req.headers.authorization;
  if (auth && auth === `Basic ${Buffer.from(`${ADMIN_EMAIL}:${ADMIN_PASSWORD}`).toString('base64')}`) {
    return next();
  }

  const token = req.cookies?.accessToken;
  if (token) {
    try {
      jwt.verify(token, JWT_SECRET);
      return next();
    } catch (err) {
      console.warn("Invalid JWT token:", err.message);
    }
  }

  res.status(401).json({ error: t('errors', 'unauthorized', "Unauthorized") });
}

// ─── SIMPLE HEALTH & TEST ROUTES ───────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

app.get("/test-email", async (req, res) => {
  try {
    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to: "test@example.com",
      subject: "Test Email from OG Barber",
      text: "This is a test email. If you see this, SMTP is working!"
    });
    res.json({ success: true, message: "Test email sent" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── MOUNT ROUTES ──────────────────────────────────────────────────────────
import { setupRoutes } from "./routes.js";
setupRoutes(app);

// ─── START SERVER ──────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`OG Barber server running → http://localhost:${PORT}`);
  console.log(`Health check:   http://localhost:${PORT}/health`);
  console.log(`Test email:     http://localhost:${PORT}/test-email`);
  console.log("JWT_SECRET loaded:", JWT_SECRET.substring(0, 8) + "... (hidden for security)");
  console.log("IMPORTANT: Update index.html BACKEND to match:");
  console.log(`const BACKEND = "http://192.168.0.8:${PORT}";`);
});