// server.js - The OG Barber Booking Server
// Main entry point: config, middleware, DB, language, email, and route mounting

import express from "express";
import cors from "cors";
import mysql from "mysql2/promise";
import nodemailer from "nodemailer";
import path from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";
import fs from "fs/promises";
import cookieParser from "cookie-parser";   // ← added for auth cookies
import jwt from "jsonwebtoken";              // ← added for JWT verification

// Route handlers
import { setupRoutes } from "./routes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 5000;

// ─── MIDDLEWARE ────────────────────────────────────────────────────────────
app.use(cors({
  origin: true,               // or specify your frontend URL e.g. "http://localhost:3000"
  credentials: true,          // ← very important for cookies to work cross-origin
}));
app.use(express.json());
app.use(cookieParser());      // ← added — parses cookies

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
      console.log(`Loaded sections: ${Object.keys(lang).join(", ")}`);
      console.log(`Test: errors.unauthorized → ${t('errors', 'unauthorized')}`);
    }
  } catch (err) {
    console.error("Failed to load language.yaml:", err.message);
    if (err.code === 'ENOENT') {
      console.error(`File not found. Expected: ${path.resolve(__dirname, "language.yaml")}`);
    } else if (err.name === 'YAMLException') {
      console.error("YAML parsing error — check indentation/quotes");
    }
    lang = {}; // fallback — t() returns key
  }
})();

// ─── CONFIG ────────────────────────────────────────────────────────────────
// Move sensitive values to .env in production!
export const JWT_SECRET = process.env.JWT_SECRET || "change-this-to-a-very-long-random-secret-9876543210abcdef";

export const DISCORD_WEBHOOK = "https://canary.discord.com/api/webhooks/1475119321020760256/nrO83jn0qfozhrb_iim7bFcjqgeD3UCG9s4JPaDCSo-05vhE3ylboPVNKVlUtDxjB8sa";

export const ADMIN_EMAIL    = "admin@ogbarber.co.uk";
export const ADMIN_PASSWORD = "SuperSecret2026!";

export const LOGO_URL       = "https://i.imgur.com/4dIWLpI.jpeg";

export const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: {
    user: "bearwallbear1@gmail.com",
    pass: "igsp hsyq umcm jcjj", // ← consider app password or moving to .env
  },
  tls: {
    rejectUnauthorized: true,
    minVersion: "TLSv1.2"
  }
});

transporter.verify((error) => {
  if (error) {
    console.error("SMTP verification failed:", error);
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
  host: "node1.infinityhosting.org",
  port: 3306,
  user: "u26_uwHqsRd4bn",
  password: "WCI6m5n4hL3rYJxkPT@zHT3!",
  database: "s26_the_og_barber",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  timezone: "Z",
  dateStrings: true,
});

// Initialize tables (unchanged)
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
    console.error("MySQL setup failed:", err);
    process.exit(1);
  }
})();

// ─── ADMIN AUTH MIDDLEWARE (updated — supports both Basic and JWT) ─────────
export function isAdmin(req, res, next) {
  // Option 1: Basic Auth (your original method — keep for admin panel if needed)
  const auth = req.headers.authorization;
  if (auth && auth === `Basic ${Buffer.from(`${ADMIN_EMAIL}:${ADMIN_PASSWORD}`).toString('base64')}`) {
    return next();
  }

  // Option 2: JWT (for future admin JWT login)
  const token = req.cookies?.accessToken;
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      // You could check if decoded has admin role here if you add roles later
      return next();
    } catch (err) {
      // token invalid/expired → fall through to unauthorized
    }
  }

  res.status(401).json({ error: t('errors', 'unauthorized', "Unauthorized") });
}

// ─── MOUNT ROUTES ──────────────────────────────────────────────────────────
setupRoutes(app);

// ─── START SERVER ──────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`OG Barber server running → http://localhost:${PORT}`);
  console.log("Health check:   http://localhost:5000/health");
  console.log("Test email:     http://localhost:5000/test-email");
});