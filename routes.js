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
  } catch {}
}

async function sendEmail(to, subject, html) {
  try {
    await transporter.sendMail({
      from: `"OG Barber" <${process.env.GMAIL_USER}>`,
      to, subject, html
    });
  } catch (e) {
    console.warn("Email failed:", e);
  }
}

function scheduleReminder(email, name, date, time) {
  const booking = new Date(`${date}T${time}`);
  const remindAt = new Date(booking.getTime() - 60*60*1000); // 1 hour before
  if (remindAt < new Date()) return;

  const task = cron.schedule(
    `${remindAt.getMinutes()} ${remindAt.getHours()} ${remindAt.getDate()} ${remindAt.getMonth()+1} *`,
    async () => {
      await sendEmail(email, "Appointment Reminder", 
        `<p>Hi ${name}, your appointment is tomorrow at ${time}.</p>`
      );
      task.stop();
    }
  );
}

function requireAuth(req, res, next) {
  const token = req.cookies?.accessToken;
  if (!token) return res.status(401).json({ error: "Not authenticated" });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(403).json({ error: "Invalid/expired token" });
  }
}

export function setupRoutes(app) {

  // ── TEST ────────────────────────────────────────
  app.get("/api/test", (_, res) => res.json({ status: "ok" }));

  // ── SIGNUP ──────────────────────────────────────
  app.post("/user/signup", async (req, res) => {
    const { email, username } = req.body;
    if (!email || !username) return res.status(400).json({ error: "Email & username required" });
    if (!validEmail(email)) return res.status(400).json({ error: "Invalid email" });

    try {
      const [exists] = await pool.query("SELECT 1 FROM users WHERE email = ?", [email]);
      if (exists.length) return res.status(409).json({ error: "Email already taken" });

      const [r] = await pool.query("INSERT INTO users (email, username) VALUES (?, ?)", [email, username]);

      const user = { id: r.insertId, email, username };
      const access = jwt.sign(user, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
      const refresh = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: REFRESH_NORMAL });

      res.cookie("accessToken", access, cookieOptions(15*60*1000));
      res.cookie("refreshToken", refresh, cookieOptions(24*60*60*1000));

      await sendDiscord("New Signup", `${username} (${email})`);

      res.json({ success: true, user });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Signup failed" });
    }
  });

  // ── LOGIN ───────────────────────────────────────
  app.post("/user/login", async (req, res) => {
    const { email, rememberMe = false } = req.body;
    if (!email) return res.status(400).json({ error: "Email required" });

    try {
      const [rows] = await pool.query("SELECT * FROM users WHERE email = ?", [email]);
      if (!rows.length) return res.status(404).json({ error: "User not found" });

      const user = rows[0];

      const access = jwt.sign(
        { id: user.id, email: user.email, username: user.username },
        JWT_SECRET,
        { expiresIn: ACCESS_TOKEN_EXPIRY }
      );

      const refreshExp = rememberMe ? REFRESH_REMEMBER : REFRESH_NORMAL;
      const refresh = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: refreshExp });

      res.cookie("accessToken", access, cookieOptions(15*60*1000));
      res.cookie("refreshToken", refresh, cookieOptions(rememberMe ? 30*24*60*60*1000 : 24*60*60*1000));

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Login failed" });
    }
  });

  // ── REFRESH ─────────────────────────────────────
  app.post("/user/refresh", async (req, res) => {
    const token = req.cookies?.refreshToken;
    if (!token) return res.status(401).json({ error: "No refresh token" });

    try {
      const { id } = jwt.verify(token, JWT_SECRET);
      const [rows] = await pool.query("SELECT id,email,username FROM users WHERE id = ?", [id]);
      if (!rows.length) throw new Error("User gone");

      const access = jwt.sign(rows[0], JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
      res.cookie("accessToken", access, cookieOptions(15*60*1000));
      res.json({ success: true });
    } catch {
      res.clearCookie("accessToken");
      res.clearCookie("refreshToken");
      res.status(403).json({ error: "Invalid refresh token" });
    }
  });

  // ── LOGOUT ──────────────────────────────────────
  app.post("/user/logout", (_, res) => {
    res.clearCookie("accessToken", { path: "/" });
    res.clearCookie("refreshToken", { path: "/" });
    res.json({ success: true });
  });

  // ── WHO AM I ────────────────────────────────────
  app.get("/user/me", requireAuth, (req, res) => {
    res.json({ user: req.user });
  });

  // ── CREATE BOOKING ──────────────────────────────
  app.post("/book", requireAuth, async (req, res) => {
    const { name, date, time, services, total, email } = req.body;

    if (!name || !date || !time || !email) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    if (!validEmail(email)) return res.status(400).json({ error: "Invalid email" });

    const dt = new Date(`${date}T${time}`);
    if (dt < new Date()) return res.status(400).json({ error: "Cannot book past date/time" });

    try {
      const [exists] = await pool.query(
        "SELECT id FROM bookings WHERE date=? AND time=? AND status!='cancelled'",
        [date, time]
      );
      if (exists.length) return res.status(409).json({ error: "Slot already booked" });

      await pool.query(
        "INSERT INTO bookings (user_id, name, date, time, services, total, email) VALUES (?,?,?,?,?,?,?)",
        [req.user.id, name, date, time, JSON.stringify(services || []), total || 0, email]
      );

      await sendDiscord("New Booking", `${name} — ${date} ${time}`);
      await sendEmail(email, "Booking Confirmed – OG Barber", `
        <h2>Confirmed!</h2>
        <p>Hello ${name},</p>
        <p>Your appointment is booked for <strong>${date}</strong> at <strong>${time}</strong>.</p>
        <p>We look forward to seeing you!</p>
      `);

      scheduleReminder(email, name, date, time);

      res.json({ success: true });
    } catch (err) {
      console.error("Booking error:", err);
      res.status(500).json({ error: "Could not create booking" });
    }
  });
}