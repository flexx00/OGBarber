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

// Load .env locally only
if (process.env.NODE_ENV !== "production") {
  dotenv.config();
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.set("trust proxy", 1);

app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

// CORS configuration
app.use(cors({
  origin: process.env.FRONTEND_URL || true,
  credentials: true,
  methods: ["GET", "POST", "OPTIONS", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

// OPTIONS preflight fix
app.options("/*all", cors());

// Logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  if (req.method === "POST" || req.method === "PUT") {
    console.log("Body:", req.body);
  }
  next();
});

// ────────────── Language YAML ──────────────
let lang = {};
async function loadLanguage() {
  try {
    const fileContents = await fs.readFile(path.join(__dirname, "language.yaml"), "utf8");
    lang = yaml.load(fileContents) || {};
    console.log("Translations loaded ✔");
  } catch {
    console.log("No language.yaml found – skipping");
  }
}

// ────────────── Environment & Secrets ──────────────
export const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error("❌ JWT_SECRET is missing in .env or Render environment variables");
  process.exit(1);
}

export const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK || "";

// ────────────── MySQL Connection ──────────────
export const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

async function initDatabase() {
  try {
    const conn = await pool.getConnection();
    console.log("MySQL connected ✔");

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
  } catch (err) {
    console.error("Database initialization failed:", err.message);
    process.exit(1);
  }
}

// ────────────── Nodemailer Email ──────────────
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
    console.log("SMTP connection ready ✔");
  } catch (err) {
    console.warn("SMTP verification failed:", err.message);
  }
}

// ────────────── Routes ──────────────
import { setupRoutes } from "./routes.js";
setupRoutes(app);

// Default homepage route
app.get("/", (_, res) => {
  res.send("🚀 OG Barber API is running! Use /signup or /login endpoints.");
});

// Health check
app.get("/health", (_, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

// 404 handler
app.use((_, res) => {
  res.status(404).json({ error: "Route not found" });
});

// Global error handler
app.use((err, _, res, __) => {
  console.error("Server error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// ────────────── Start server ──────────────
async function startServer() {
  await loadLanguage();
  await initDatabase();
  await verifySMTP();

  app.listen(PORT, () => {
    console.log(`🚀 OG Barber API running on http://localhost:${PORT}`);
    console.log(`Health:              http://localhost:${PORT}/health`);
  });

  process.on("SIGINT", () => {
    console.log("\nShutting down...");
    process.exit(0);
  });
}

startServer();