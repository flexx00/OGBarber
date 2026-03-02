// server.js
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

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.set("trust proxy", 1);

app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:5173",
  credentials: true
}));

app.options("*", cors());

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// ───────────────────────────────────────────────
// Language (optional)
// ───────────────────────────────────────────────
let lang = {};
async function loadLanguage() {
  try {
    const file = await fs.readFile(path.join(__dirname, "language.yaml"), "utf8");
    lang = yaml.load(file) || {};
    console.log("Translations loaded");
  } catch {}
}
loadLanguage();

// ───────────────────────────────────────────────
// ENV & JWT
// ───────────────────────────────────────────────
export const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error("JWT_SECRET missing");
  process.exit(1);
}

export const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK || "";

// ───────────────────────────────────────────────
// MySQL Pool
// ───────────────────────────────────────────────
export const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
});

async function initDatabase() {
  const conn = await pool.getConnection();
  console.log("MySQL connected");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      username VARCHAR(100) NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bookings (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      name VARCHAR(100),
      date DATE NOT NULL,
      time TIME NOT NULL,
      services JSON,
      total DECIMAL(10,2),
      email VARCHAR(255),
      phone VARCHAR(20),
      status ENUM('pending','confirmed','completed','cancelled') DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE KEY unique_slot (date, time, status),
      INDEX idx_date (date)
    )
  `);

  conn.release();
}

// ───────────────────────────────────────────────
// Nodemailer
// ───────────────────────────────────────────────
export const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS
  }
});

async function verifySMTP() {
  try {
    await transporter.verify();
    console.log("SMTP verified");
  } catch (e) {
    console.warn("SMTP issue:", e.message);
  }
}

// ───────────────────────────────────────────────
// Routes
// ───────────────────────────────────────────────
import { setupRoutes } from "./routes.js";
setupRoutes(app);

// Health
app.get("/health", (_, res) => res.json({ status: "ok", uptime: process.uptime() }));

// Booked times (called from frontend)
app.get("/booked/:date", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT time FROM bookings WHERE date = ? AND status != 'cancelled'",
      [req.params.date]
    );
    res.json(rows.map(r => r.time.slice(0,5))); // HH:MM
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// 404 + error
app.use((_, res) => res.status(404).json({ error: "Not found" }));
app.use((err, _, res, __) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

// ───────────────────────────────────────────────
async function start() {
  await initDatabase();
  await verifySMTP();

  app.listen(PORT, () => {
    console.log(`OG Barber API → http://localhost:${PORT}`);
  });
}

start();