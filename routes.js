// routes.js - OG Barber API (Mobile Safe + Secure 2026)

import { pool, transporter, JWT_SECRET, ADMIN_EMAIL, DISCORD_WEBHOOK } from "./server.js";
import jwt from "jsonwebtoken";
import fetch from "node-fetch";
import cron from "node-cron";

// ─────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────

const ACCESS_TOKEN_EXPIRY = "15m";
const REFRESH_TOKEN_EXPIRY_NORMAL = "1d";
const REFRESH_TOKEN_EXPIRY_REMEMBER = "30d";

const isProduction = process.env.NODE_ENV === "production";

// ✅ MOBILE SAFE COOKIE CONFIG
function getCookieOptions(maxAge) {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "None" : "Lax",
    path: "/",
    maxAge,
  };
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

async function sendDiscordWebhook(title, description, color = 3447003) {
  if (!DISCORD_WEBHOOK) return;
  try {
    await fetch(DISCORD_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [{ title, description, color }] })
    });
  } catch (err) {
    console.error("Discord webhook failed:", err.message);
  }
}

async function sendEmail(to, subject, html) {
  try {
    await transporter.sendMail({
      from: `"OG Barber" <${process.env.GMAIL_USER}>`,
      to,
      subject,
      html
    });
  } catch (err) {
    console.error("Email failed:", err.message);
  }
}

function scheduleReminder(email, name, date, time) {
  const bookingTime = new Date(`${date}T${time}:00`);
  const oneHourBefore = new Date(bookingTime.getTime() - 60 * 60 * 1000);

  cron.schedule(
    `${oneHourBefore.getMinutes()} ${oneHourBefore.getHours()} ${oneHourBefore.getDate()} ${oneHourBefore.getMonth() + 1} *`,
    () => {
      sendEmail(
        email,
        "Appointment Reminder",
        `<h2>Reminder</h2><p>Hi ${name}, your appointment is at ${time} on ${date}.</p>`
      );
    }
  );
}

// ─────────────────────────────────────────────
// AUTH MIDDLEWARE
// ─────────────────────────────────────────────

function requireAuth(req, res, next) {
  const token = req.cookies?.accessToken;
  if (!token) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    console.warn("Token verification failed:", err.message);
    return res.status(403).json({ error: "Invalid or expired token" });
  }
}

// ─────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────

export function setupRoutes(app) {

  // ───────────────────────── GET CONNECTIVITY TEST
  app.get("/api/test", (req, res) => {
    console.log(`GET /api/test hit from IP: ${req.ip}`);
    res.json({ status: "ok", message: "GET test successful from server" });
  });

  // ───────────────────────── POST CONNECTIVITY TEST (no auth, echoes body)
  app.post("/api/test-post", (req, res) => {
    console.log(`POST /api/test-post hit from IP: ${req.ip}`);
    console.log("Received body:", req.body);
    res.json({
      status: "ok",
      message: "POST test successful",
      receivedData: req.body
    });
  });

  // ───────────────────────── USER SIGNUP
  app.post("/user/signup", async (req, res) => {
    console.log(`Signup attempt from IP: ${req.ip} | Body:`, req.body);
    const { email, username } = req.body;
    if (!email || !username) {
      return res.status(400).json({ error: "Email and username required" });
    }

    try {
      const [existing] = await pool.query("SELECT id FROM users WHERE email = ?", [email]);
      if (existing.length) {
        return res.status(409).json({ error: "Email already registered" });
      }

      const [result] = await pool.query("INSERT INTO users (email, username) VALUES (?, ?)", [email, username]);
      const user = { id: result.insertId, email, username };

      const accessToken = jwt.sign(user, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
      const refreshToken = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRY_NORMAL });

      res.cookie("accessToken", accessToken, getCookieOptions(15 * 60 * 1000));
      res.cookie("refreshToken", refreshToken, getCookieOptions(24 * 60 * 60 * 1000));

      await sendDiscordWebhook("New Signup", `User: ${username}\nEmail: ${email}`);

      res.json({ success: true, user });
    } catch (err) {
      console.error("Signup error:", err.message);
      res.status(500).json({ error: "Server error during signup" });
    }
  });

  // ───────────────────────── USER LOGIN
  app.post("/user/login", async (req, res) => {
    console.log(`Login attempt from IP: ${req.ip} | Body:`, req.body);
    const { email, rememberMe = false } = req.body;
    if (!email) {
      return res.status(400).json({ error: "Email required" });
    }

    try {
      const [rows] = await pool.query("SELECT * FROM users WHERE email = ?", [email]);
      if (!rows.length) {
        return res.status(404).json({ error: "User not found" });
      }

      const user = rows[0];
      const accessToken = jwt.sign(
        { id: user.id, email: user.email, username: user.username },
        JWT_SECRET,
        { expiresIn: ACCESS_TOKEN_EXPIRY }
      );

      const refreshExpiry = rememberMe ? REFRESH_TOKEN_EXPIRY_REMEMBER : REFRESH_TOKEN_EXPIRY_NORMAL;
      const refreshToken = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: refreshExpiry });

      res.cookie("accessToken", accessToken, getCookieOptions(15 * 60 * 1000));
      res.cookie("refreshToken", refreshToken, getCookieOptions(
        rememberMe ? 30 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000
      ));

      res.json({ success: true });
    } catch (err) {
      console.error("Login error:", err.message);
      res.status(500).json({ error: "Server error during login" });
    }
  });

  // ───────────────────────── REFRESH TOKEN
  app.post("/user/refresh", (req, res) => {
    const refreshToken = req.cookies?.refreshToken;
    if (!refreshToken) {
      return res.status(401).json({ error: "No refresh token provided" });
    }

    try {
      const decoded = jwt.verify(refreshToken, JWT_SECRET);
      const newAccessToken = jwt.sign({ id: decoded.id }, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
      res.cookie("accessToken", newAccessToken, getCookieOptions(15 * 60 * 1000));
      res.json({ success: true });
    } catch (err) {
      console.warn("Refresh token invalid:", err.message);
      res.clearCookie("accessToken", { path: "/" });
      res.clearCookie("refreshToken", { path: "/" });
      res.status(403).json({ error: "Invalid or expired refresh token" });
    }
  });

  // ───────────────────────── LOGOUT
  app.post("/user/logout", (req, res) => {
    res.clearCookie("accessToken", { path: "/" });
    res.clearCookie("refreshToken", { path: "/" });
    res.json({ success: true });
  });

  // ───────────────────────── TEST AUTH (requires valid accessToken cookie)
  app.get("/user/me", requireAuth, (req, res) => {
    res.json({ success: true, user: req.user });
  });

  // ───────────────────────── CREATE BOOKING
  app.post("/book", requireAuth, async (req, res) => {
    const { name, date, time, services, total, email, phone } = req.body;

    if (!name || !date || !time || !Array.isArray(services) || !total || !email) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    try {
      await pool.query(
        "INSERT INTO bookings (user_id, name, date, time, services, total, email, phone) VALUES (?,?,?,?,?,?,?,?)",
        [req.user.id, name, date, time, JSON.stringify(services), total, email, phone || null]
      );

      await sendDiscordWebhook("New Booking", `${name}\n${date} ${time}\n£${total}`, 16753920);

      await sendEmail(email, "Booking Confirmed", `<h2>Booking Confirmed</h2><p>${date} at ${time}</p>`);

      scheduleReminder(email, name, date, time);

      res.json({ success: true });
    } catch (err) {
      if (err.code === "ER_DUP_ENTRY") {
        return res.status(409).json({ error: "Time slot already booked" });
      }
      console.error("Booking error:", err.message);
      res.status(500).json({ error: "Server error during booking" });
    }
  });
}