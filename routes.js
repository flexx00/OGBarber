// routes.js
import { pool, transporter, JWT_SECRET, DISCORD_WEBHOOK } from "./server.js";
import jwt from "jsonwebtoken";
import cron from "node-cron";

const ACCESS_TOKEN_EXPIRY  = "15m";
const REFRESH_NORMAL       = "1d";
const REFRESH_REMEMBER     = "30d";
const isProd = process.env.NODE_ENV === "production";

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
    await transporter.sendMail({
      from: `"OG Barber" <${process.env.GMAIL_USER}>`,
      to, subject, html
    });
  } catch (err) {
    console.warn("Email send failed:", err.message);
  }
}

function scheduleReminder(email, name, date, time) {
  const booking = new Date(`${date}T${time}`);
  const remindAt = new Date(booking.getTime() - 60*60*1000); // 1 hour before
  if (remindAt < new Date()) return;

  cron.schedule(
    `${remindAt.getMinutes()} ${remindAt.getHours()} ${remindAt.getDate()} ${remindAt.getMonth()+1} *`,
    async () => {
      await sendEmail(email, "Appointment Reminder – OG Barber",
        `<p>Hi ${name},</p><p>Your appointment is tomorrow at <strong>${time}</strong>.</p>`
      );
    },
    { scheduled: true, timezone: "Europe/London" } // ← adjust timezone if needed
  );
}

function requireAuth(req, res, next) {
  const token = req.cookies?.accessToken;
  if (!token) return res.status(401).json({ error: "Not authenticated" });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    res.status(403).json({ error: "Invalid or expired token" });
  }
}

export function setupRoutes(app) {

  // ── TEST ENDPOINTS ───────────────────────────────
  app.get("/api/test", (_, res) => res.json({ status: "ok" }));

  // ── SIGNUP ───────────────────────────────────────
  app.post("/user/signup", async (req, res) => {
    const { email, username } = req.body;
    if (!email || !username) return res.status(400).json({ error: "Email and username required" });
    if (!validEmail(email)) return res.status(400).json({ error: "Invalid email format" });

    try {
      const [existing] = await pool.query("SELECT id FROM users WHERE email = ?", [email]);
      if (existing.length) return res.status(409).json({ error: "Email already registered" });

      const [result] = await pool.query(
        "INSERT INTO users (email, username) VALUES (?, ?)",
        [email, username]
      );

      const user = { id: result.insertId, email, username };
      const accessToken = jwt.sign(user, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
      const refreshToken = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: REFRESH_NORMAL });

      res.cookie("accessToken", accessToken, cookieOptions(15 * 60 * 1000));
      res.cookie("refreshToken", refreshToken, cookieOptions(24 * 60 * 60 * 1000));

      await sendDiscord("New Signup", `${username} (${email})`);

      res.json({ success: true, user });
    } catch (err) {
      console.error("Signup error:", err);
      res.status(500).json({ error: "Signup failed" });
    }
  });

  // ── LOGIN ────────────────────────────────────────
  app.post("/user/login", async (req, res) => {
    const { email, rememberMe = false } = req.body;
    if (!email) return res.status(400).json({ error: "Email required" });

    try {
      const [rows] = await pool.query("SELECT * FROM users WHERE email = ?", [email]);
      if (!rows.length) return res.status(404).json({ error: "User not found" });

      const user = rows[0];

      const accessToken = jwt.sign(
        { id: user.id, email: user.email, username: user.username },
        JWT_SECRET,
        { expiresIn: ACCESS_TOKEN_EXPIRY }
      );

      const refreshExpiry = rememberMe ? REFRESH_REMEMBER : REFRESH_NORMAL;
      const refreshToken = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: refreshExpiry });

      res.cookie("accessToken", accessToken, cookieOptions(15 * 60 * 1000));
      res.cookie("refreshToken", refreshToken, cookieOptions(
        rememberMe ? 30 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000
      ));

      res.json({ success: true });
    } catch (err) {
      console.error("Login error:", err);
      res.status(500).json({ error: "Login failed" });
    }
  });

  // ── REFRESH TOKEN ────────────────────────────────
  app.post("/user/refresh", async (req, res) => {
    const token = req.cookies?.refreshToken;
    if (!token) return res.status(401).json({ error: "No refresh token provided" });

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const [rows] = await pool.query(
        "SELECT id, email, username FROM users WHERE id = ?",
        [decoded.id]
      );

      if (!rows.length) return res.status(401).json({ error: "User no longer exists" });

      const accessToken = jwt.sign(rows[0], JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
      res.cookie("accessToken", accessToken, cookieOptions(15 * 60 * 1000));
      res.json({ success: true });
    } catch {
      res.clearCookie("accessToken");
      res.clearCookie("refreshToken");
      res.status(403).json({ error: "Invalid refresh token" });
    }
  });

  // ── LOGOUT ───────────────────────────────────────
  app.post("/user/logout", (req, res) => {
    res.clearCookie("accessToken", { path: "/" });
    res.clearCookie("refreshToken", { path: "/" });
    res.json({ success: true });
  });

  // ── GET CURRENT USER ─────────────────────────────
  app.get("/user/me", requireAuth, (req, res) => {
    res.json({ user: req.user });
  });

  // ── CREATE BOOKING ───────────────────────────────
  app.post("/book", requireAuth, async (req, res) => {
    const { name, date, time, services, total, email } = req.body;

    if (!name || !date || !time || !email) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    if (!validEmail(email)) return res.status(400).json({ error: "Invalid email format" });

    const bookingDateTime = new Date(`${date}T${time}`);
    if (bookingDateTime < new Date()) {
      return res.status(400).json({ error: "Cannot book in the past" });
    }

    try {
      const [existing] = await pool.query(
        "SELECT id FROM bookings WHERE date = ? AND time = ? AND status != 'cancelled'",
        [date, time]
      );

      if (existing.length) {
        return res.status(409).json({ error: "This time slot is already booked" });
      }

      await pool.query(
        "INSERT INTO bookings (user_id, name, date, time, services, total, email) VALUES (?,?,?,?,?,?,?)",
        [req.user.id, name, date, time, JSON.stringify(services || []), total || 0, email]
      );

      await sendDiscord("New Booking", `${name} booked ${date} at ${time}`);
      await sendEmail(email, "Booking Confirmed – OG Barber", `
        <h2>Booking Confirmed!</h2>
        <p>Hello ${name},</p>
        <p>Your appointment is set for <strong>${date}</strong> at <strong>${time}</strong>.</p>
        <p>We look forward to seeing you!</p>
      `);

      scheduleReminder(email, name, date, time);

      res.json({ success: true });
    } catch (err) {
      console.error("Booking error:", err);
      res.status(500).json({ error: "Failed to create booking" });
    }
  });

  // ── GET BOOKED TIMES FOR A DATE ──────────────────
  app.get("/booked/:date", async (req, res) => {
    try {
      const [rows] = await pool.query(
        "SELECT TIME_FORMAT(time, '%H:%i') as time FROM bookings WHERE date = ? AND status != 'cancelled'",
        [req.params.date]
      );
      res.json(rows.map(row => row.time));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch booked times" });
    }
  });
}