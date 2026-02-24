// routes.js - All API endpoints for The OG Barber

import express from "express";
import { pool, transporter, JWT_SECRET, LOGO_URL, ADMIN_EMAIL, DISCORD_WEBHOOK } from "./server.js";
import jwt from "jsonwebtoken";
import fetch from "node-fetch";
import cron from "node-cron";
import yaml from "js-yaml";
import fs from "fs/promises";
import path from "path";

// ────────────────────────────────────────────────
// Language loading & helpers (self-contained)
// ────────────────────────────────────────────────
let lang = {
  shop: {},
  email: { subjects: {}, labels: {} },
  discord: {},
  errors: {},
  frontend: {},
  admin: {}
};

async function loadLanguage() {
  const yamlPath = path.join(process.cwd(), "language.yaml");
  try {
    const fileContent = await fs.readFile(yamlPath, "utf8");
    const data = yaml.load(fileContent);

    lang = {
      ...lang,
      shop: data?.shop || lang.shop,
      email: {
        subjects: data?.email?.subjects || lang.email.subjects,
        labels: data?.email?.labels || lang.email.labels,
      },
      discord: data?.discord || lang.discord,
      errors: data?.errors || lang.errors,
      frontend: data?.frontend || lang.frontend,
      admin: data?.admin || lang.admin,
    };

    console.log(`language.yaml loaded (${Object.keys(lang).length} sections)`);
  } catch (err) {
    console.error("Failed to load language.yaml — using fallbacks");
    console.error("Path:", yamlPath);
    console.error(err.message);
  }
}

// Load once when routes are initialized
await loadLanguage();

// Translation helpers (local to this file)
function t(section, key, fallback = null) {
  return lang?.[section]?.[key] ?? fallback ?? key;
}

function tEmailSubject(key, fallback = null) {
  return lang?.email?.subjects?.[key] ?? fallback ?? key;
}

function tEmailLabel(key, fallback = null) {
  return lang?.email?.labels?.[key] ?? fallback ?? key;
}

// ─── JWT Config ─────────────────────────────────────────────────────────────
const ACCESS_TOKEN_EXPIRY = "15m";
const REFRESH_TOKEN_EXPIRY_NORMAL = "1d";
const REFRESH_TOKEN_EXPIRY_REMEMBER = "30d";

// ─── EMAIL & DISCORD HELPERS ───────────────────────────────────────────────
function buildEmailHtml({ subject, greetingName, intro, details = {}, closing }) {
  const detailRows = Object.entries(details)
    .map(([key, value]) => `
      <tr>
        <td style="padding: 10px 0; color: #1a1a1a; font-size: 15px; font-weight: 600; width: 140px;">
          ${tEmailLabel(key.toLowerCase(), key)}:
        </td>
        <td style="padding: 10px 0; color: #444444; font-size: 15px;">
          ${value}
        </td>
      </tr>
    `).join("");

  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${subject}</title></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f5f5f5;color:#333;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f5f5;padding:30px 10px;">
    <tr><td align="center">
      <table width="100%" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.08);">
        <tr><td style="background:#0a0a0a;padding:32px 24px;text-align:center;">
          <img src="${LOGO_URL}" alt="${t('shop','name')}" style="max-width:220px;height:auto;display:block;margin:0 auto;" />
        </td></tr>
        <tr><td style="padding:40px 32px 32px;line-height:1.65;font-size:15px;">
          <p style="margin:0 0 20px;">Hi ${greetingName},</p>
          <p style="margin:0 0 28px;">${intro}</p>
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">${detailRows}</table>
          <p style="margin:28px 0 36px;">${closing}</p>
          <a href="mailto:${ADMIN_EMAIL}" style="display:inline-block;background:#0a0a0a;color:#fff;padding:14px 36px;text-decoration:none;border-radius:6px;font-weight:500;font-size:15px;">
            Contact Us
          </a>
        </td></tr>
        <tr><td style="background:#fafafa;padding:28px 32px;text-align:center;font-size:13px;color:#666;border-top:1px solid #eee;">
          <p style="margin:0 0 8px;">${t('shop','name')}<br>${t('shop','address')}<br>${t('shop','phone')}</p>
          <p style="margin:12px 0 0;">© ${new Date().getFullYear()} ${t('shop','name')}. All rights reserved.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();
}

function buildPlainTextFallback({ greetingName, intro, details = {}, closing }) {
  let text = `${t('shop','name')}\n\nHi ${greetingName},\n\n${intro}\n\n`;
  Object.entries(details).forEach(([k, v]) => {
    text += `${tEmailLabel(k.toLowerCase(), k).padEnd(14)} ${v}\n`;
  });
  text += `\n${closing}\n\nContact Us,\nThe OG Barber Team\n${ADMIN_EMAIL}\n${t('shop','phone')}\n`;
  return text.trim();
}

async function sendEmail(to, subjectKey, { greetingName, introKey, details = {}, closingKey }) {
  const subject = tEmailSubject(subjectKey, subjectKey);
  const intro   = t('email', introKey, introKey);
  const closing = t('email', closingKey, closingKey);

  const html = buildEmailHtml({ subject, greetingName, intro, details, closing });
  const text = buildPlainTextFallback({ greetingName, intro, details, closing });

  try {
    const info = await transporter.sendMail({
      from: `"${t('shop','name')}" <${process.env.GMAIL_USER}>`,
      to,
      subject,
      text,
      html,
    });
    console.log(`Email sent to ${to} — ${subject} (${info.messageId})`);
    return true;
  } catch (err) {
    console.error("Email send failed:", err.message);
    return false;
  }
}

async function sendDiscordWebhook(titleKey, description, color = 3447003) {
  const title = t('discord', titleKey, titleKey);
  try {
    const res = await fetch(DISCORD_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "Notification",
        embeds: [{ title, description, color }]
      }),
    });
    if (!res.ok) throw new Error(await res.text());
    console.log(`Discord sent: ${title}`);
  } catch (err) {
    console.error("Discord failed:", err.message);
  }
}

function scheduleReminders({ name, date, time, email, services }) {
  const bookingTime = new Date(`${date}T${time}:00Z`);

  const dayBefore = new Date(bookingTime.getTime() - 24 * 60 * 60 * 1000);
  cron.schedule(
    `${dayBefore.getUTCMinutes()} ${dayBefore.getUTCHours()} ${dayBefore.getUTCDate()} ${dayBefore.getUTCMonth() + 1} *`,
    () => sendEmail(email, "reminder_tomorrow", {
      greetingName: name,
      introKey: "reminder_tomorrow_intro",
      details: { date, time, services, location: t('shop','address') },
      closingKey: "closing_tomorrow"
    })
  );

  const hourBefore = new Date(bookingTime.getTime() - 60 * 60 * 1000);
  cron.schedule(
    `${hourBefore.getUTCMinutes()} ${hourBefore.getUTCHours()} ${hourBefore.getUTCDate()} ${hourBefore.getUTCMonth() + 1} *`,
    () => sendEmail(email, "reminder_one_hour", {
      greetingName: name,
      introKey: "reminder_one_hour_intro",
      details: { time, services, location: t('shop','address') },
      closingKey: "closing_one_hour"
    })
  );
}

// ─── REGISTER ALL ROUTES ───────────────────────────────────────────────────
export function setupRoutes(app) {
  // ── Public routes ────────────────────────────────────────

  app.post("/user/signup", async (req, res) => {
    const { email, username } = req.body;
    if (!email || !username) {
      return res.status(400).json({ error: t('errors', 'missing_fields', 'Missing email or username') });
    }

    try {
      const [rows] = await pool.query("SELECT id FROM users WHERE email = ?", [email]);
      if (rows.length) {
        return res.status(409).json({ error: t('errors', 'email_already_registered', 'Email already in use') });
      }

      const [result] = await pool.query(
        "INSERT INTO users (email, username) VALUES (?, ?)",
        [email, username]
      );

      await sendDiscordWebhook("new_signup_title", `**${username}** | ${email}`);

      res.json({ user: { id: result.insertId, email, username } });
    } catch (err) {
      console.error("Signup error:", err);
      res.status(500).json({ error: t('errors', 'server_error', 'Server error') });
    }
  });

  app.post("/user/login", async (req, res) => {
    const { email, rememberMe = false } = req.body;

    if (!email) {
      return res.status(400).json({ error: t('errors', 'email_required', 'Email is required') });
    }

    try {
      const [rows] = await pool.query("SELECT * FROM users WHERE email = ?", [email]);
      if (!rows.length) {
        return res.status(404).json({ error: t('errors', 'user_not_found', 'User not found') });
      }

      const user = rows[0];

      const accessToken = jwt.sign(
        { id: user.id, email: user.email, username: user.username },
        JWT_SECRET,
        { expiresIn: ACCESS_TOKEN_EXPIRY }
      );

      const refreshExpiry = rememberMe ? REFRESH_TOKEN_EXPIRY_REMEMBER : REFRESH_TOKEN_EXPIRY_NORMAL;
      const refreshToken = jwt.sign(
        { id: user.id },
        JWT_SECRET,
        { expiresIn: refreshExpiry }
      );

      const cookieOptions = {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
      };

      res.cookie("accessToken", accessToken, { ...cookieOptions, maxAge: 15 * 60 * 1000 });
      res.cookie("refreshToken", refreshToken, { ...cookieOptions, maxAge: rememberMe ? 30 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000 });

      res.json({
        success: true,
        user: { id: user.id, email: user.email, username: user.username },
        rememberMeUsed: rememberMe,
      });
    } catch (err) {
      console.error("Login error:", err);
      res.status(500).json({ error: t('errors', 'server_error', 'Server error') });
    }
  });

  app.post("/user/refresh", (req, res) => {
    const refreshToken = req.cookies.refreshToken;
    if (!refreshToken) return res.status(401).json({ error: "No refresh token" });

    try {
      const decoded = jwt.verify(refreshToken, JWT_SECRET);

      const accessToken = jwt.sign(
        { id: decoded.id },
        JWT_SECRET,
        { expiresIn: ACCESS_TOKEN_EXPIRY }
      );

      res.cookie("accessToken", accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 15 * 60 * 1000,
      });

      res.json({ success: true });
    } catch (err) {
      res.clearCookie("refreshToken");
      res.clearCookie("accessToken");
      res.status(403).json({ error: "Invalid or expired refresh token" });
    }
  });

  app.post("/user/logout", (req, res) => {
    res.clearCookie("accessToken");
    res.clearCookie("refreshToken");
    res.json({ success: true });
  });

  // ── Booking routes ──────────────────────────────────────
  app.get("/booked/:date", async (req, res) => {
    try {
      const [rows] = await pool.query(
        "SELECT TIME_FORMAT(time, '%H:%i') AS time FROM bookings WHERE date = ?",
        [req.params.date]
      );
      res.json(rows.map(r => r.time));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: t('errors', 'server_error', 'Server error') });
    }
  });

  app.post("/book", async (req, res) => {
    const { name, date, time, services, total, email, phone } = req.body;

    if (!name || !date || !time || !email || !Array.isArray(services) || services.length === 0) {
      return res.status(400).json({ error: t('errors', 'missing_or_invalid_fields', 'Missing or invalid fields') });
    }

    try {
      const [users] = await pool.query("SELECT id FROM users WHERE email = ?", [email]);
      if (!users.length) return res.status(404).json({ error: t('errors', 'user_not_found', 'User not found') });

      await pool.query(
        "INSERT INTO bookings (user_id, name, date, time, services, total, email, phone) VALUES (?,?,?,?,?,?,?,?)",
        [users[0].id, name, date, time, JSON.stringify(services), total, email, phone || null]
      );

      const servicesList = services.map(s => s.name).join(", ");

      await sendDiscordWebhook("new_booking_title", `**${name}** — ${date} ${time}\nServices: ${servicesList}\n£${total}`, 16753920);

      await sendEmail(email, "booking_confirmed", {
        greetingName: name,
        introKey: "booking_success_intro",
        details: { date, time, services: servicesList, total: `£${total}`, location: t('shop','address') },
        closingKey: "closing_standard"
      });

      scheduleReminders({ name, date, time, email, services: servicesList });

      res.json({ success: true });
    } catch (err) {
      console.error("Booking error:", err);
      if (err.code === "ER_DUP_ENTRY") {
        return res.status(409).json({ error: t('errors', 'slot_already_booked', 'Slot already booked') });
      }
      res.status(500).json({ error: t('errors', 'server_error', 'Server error') });
    }
  });

  // ── Admin routes (placeholder) ──────────────────────────
  app.get("/admin/bookings", (req, res) => {
    res.json({ message: "Admin bookings endpoint – implement later" });
  });
}