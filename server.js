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
import bcrypt from "bcrypt";
import cron from "node-cron";
import fetch from "node-fetch"; // for Discord webhook

// ────────────── Load .env locally ──────────────
if (process.env.NODE_ENV !== "production") {
  dotenv.config();
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// ────────────── Express setup ──────────────
app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

const FRONTEND_URL = process.env.FRONTEND_URL || "*"; // set your frontend URL here
const isProd = process.env.NODE_ENV === "production";

app.use(cors({
  origin: FRONTEND_URL,
  credentials: true,
  methods: ["GET", "POST", "OPTIONS", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.options("/*all", cors());

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  if (["POST", "PUT"].includes(req.method)) console.log("Body:", req.body);
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
export const JWT_SECRET = process.env.JWT_SECRET || "fallbacksecret";
export const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK || "";

function cookieOptions(maxAge) {
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "None" : "Lax",
    path: "/",
    maxAge
  };
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ────────────── MySQL Pool ──────────────
export const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "ogbarber",
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
        password VARCHAR(255) NOT NULL,
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
    console.warn("Database initialization failed:", err.message);
  }
}

// ────────────── Nodemailer ──────────────
export const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER || "",
    pass: process.env.GMAIL_PASS || ""
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

// ────────────── Helpers ──────────────
async function sendDiscord(title, desc, color = 3447003) {
  if (!DISCORD_WEBHOOK) return;
  try {
    await fetch(DISCORD_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [{ title, description: desc, color }] })
    });
  } catch (err) {
    console.warn("Discord webhook failed:", err.message);
  }
}

async function sendEmail(to, subject, html) {
  try {
    await transporter.sendMail({ from: `"OG Barber" <${process.env.GMAIL_USER}>`, to, subject, html });
  } catch (err) {
    console.warn("Email send failed:", err.message);
  }
}

function scheduleReminder(email, name, date, time) {
  const booking = new Date(`${date}T${time}`);
  const remindAt = new Date(booking.getTime() - 60*60*1000);
  if (remindAt < new Date()) return;

  cron.schedule(
    `${remindAt.getMinutes()} ${remindAt.getHours()} ${remindAt.getDate()} ${remindAt.getMonth()+1} *`,
    async () => {
      await sendEmail(email, "Appointment Reminder – OG Barber",
        `<p>Hi ${name},</p><p>Your appointment is tomorrow at <strong>${time}</strong>.</p>`
      );
    },
    { scheduled: true, timezone: "Europe/London" }
  );
}

function requireAuth(req, res, next) {
  const token = req.cookies?.accessToken;
  if (!token) return res.status(401).json({ error: "Not authenticated" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(403).json({ error: "Invalid or expired token" });
  }
}

// ────────────── Routes ──────────────
app.get("/", (_, res) => res.send("🚀 OG Barber API is running! Use /user/signup or /user/login"));
app.get("/test-port", (_, res) => res.send("Port is working!"));
app.get("/health", (_, res) => res.json({ status: "ok", uptime: process.uptime() }));

// ── Signup
app.post("/user/signup", async (req, res) => {
  const { email, username, password } = req.body;
  if (!email || !username || !password) return res.status(400).json({ error: "Email, username, password required" });
  if (!validEmail(email)) return res.status(400).json({ error: "Invalid email" });

  try {
    const [existing] = await pool.query("SELECT id FROM users WHERE email = ?", [email]);
    if (existing.length) return res.status(409).json({ error: "Email already registered" });

    const hashed = await bcrypt.hash(password, 10);
    const [result] = await pool.query("INSERT INTO users (email, username, password) VALUES (?,?,?)", [email, username, hashed]);
    const user = { id: result.insertId, email, username };
    const accessToken = jwt.sign(user, JWT_SECRET, { expiresIn: "15m" });
    const refreshToken = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: "1d" });

    res.cookie("accessToken", accessToken, cookieOptions(15*60*1000));
    res.cookie("refreshToken", refreshToken, cookieOptions(24*60*60*1000));

    await sendDiscord("New Signup", `${username} (${email})`);
    res.json({ success: true, user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Signup failed" });
  }
});

// ── Login
app.post("/user/login", async (req, res) => {
  const { email, password, rememberMe = false } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email & password required" });

  try {
    const [rows] = await pool.query("SELECT * FROM users WHERE email = ?", [email]);
    if (!rows.length) return res.status(404).json({ error: "User not found" });
    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password || "");
    if (!valid) return res.status(400).json({ error: "Invalid credentials" });

    const accessToken = jwt.sign({ id: user.id, email: user.email, username: user.username }, JWT_SECRET, { expiresIn: "15m" });
    const refreshExpiry = rememberMe ? "30d" : "1d";
    const refreshToken = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: refreshExpiry });

    res.cookie("accessToken", accessToken, cookieOptions(15*60*1000));
    res.cookie("refreshToken", refreshToken, cookieOptions(rememberMe ? 30*24*60*60*1000 : 24*60*60*1000));
    res.json({ success: true, user: { id: user.id, email: user.email, username: user.username } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Login failed" });
  }
});

// ── Logout
app.post("/user/logout", (req, res) => {
  res.clearCookie("accessToken", { path: "/" });
  res.clearCookie("refreshToken", { path: "/" });
  res.json({ success: true });
});

// ── Current User
app.get("/user/me", requireAuth, (req, res) => res.json({ user: req.user }));

// ── Bookings
app.post("/book", requireAuth, async (req, res) => {
  const { name, date, time, services, total, email } = req.body;
  if (!name || !date || !time || !email) return res.status(400).json({ error: "Missing required fields" });
  if (!validEmail(email)) return res.status(400).json({ error: "Invalid email" });
  if (new Date(`${date}T${time}`) < new Date()) return res.status(400).json({ error: "Cannot book in past" });

  try {
    const [existing] = await pool.query("SELECT id FROM bookings WHERE date=? AND time=? AND status!='cancelled'", [date,time]);
    if (existing.length) return res.status(409).json({ error: "Time slot already booked" });

    await pool.query("INSERT INTO bookings (user_id,name,date,time,services,total,email) VALUES (?,?,?,?,?,?,?)",
      [req.user.id, name, date, time, JSON.stringify(services||[]), total||0, email]);

    await sendDiscord("New Booking", `${name} booked ${date} at ${time}`);
    await sendEmail(email, "Booking Confirmed – OG Barber", `<h2>Booking Confirmed</h2><p>${name}, your appointment is set for ${date} at ${time}.</p>`);
    scheduleReminder(email,name,date,time);

    res.json({ success: true });
  } catch(err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create booking" });
  }
});

// ── Booked times
app.get("/booked/:date", async (req,res)=>{
  try{
    const [rows] = await pool.query("SELECT TIME_FORMAT(time,'%H:%i') as time FROM bookings WHERE date=? AND status!='cancelled'", [req.params.date]);
    res.json(rows.map(r=>r.time));
  }catch(err){console.error(err);res.status(500).json({error:"Failed to fetch booked times"});}
});

// ────────────── Start server ──────────────
async function startServer(){
  await loadLanguage();
  await initDatabase();
  await verifySMTP();

  app.listen(PORT,()=>console.log(`🚀 OG Barber API running on port ${PORT}`));
}

startServer();