import "dotenv/config";

import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import multer from "multer";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { randomInt } from "node:crypto";

// ==========================================
// ENVIRONMENT VARIABLES
// ==========================================

const supabaseUrl =
  process.env.SUPABASE_URL ||
  "https://ltnhgjgoxqxztfsqahce.supabase.co";

const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.error("❌ SUPABASE_SERVICE_ROLE_KEY missing in environment");
  process.exit(1);
}

// ==========================================
// MAILJET API CONFIGURATION
// ==========================================

const MAILJET_API_KEY = process.env.MAILJET_API_KEY;
const MAILJET_SECRET_KEY = process.env.MAILJET_SECRET_KEY;
const MAILJET_SENDER_EMAIL = process.env.MAILJET_SENDER_EMAIL;

if (!MAILJET_API_KEY || !MAILJET_SECRET_KEY || !MAILJET_SENDER_EMAIL) {
  console.error("❌ Mailjet environment variables missing");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const app = express();
app.set("trust proxy", 1);

// ==========================================
// PLAYER JWT + ACCOUNT SECURITY
// ==========================================

const SUPPORT_JWT_SECRET = process.env.SUPPORT_JWT_SECRET;

if (!SUPPORT_JWT_SECRET || SUPPORT_JWT_SECRET.length < 32) {
  console.error("❌ SUPPORT_JWT_SECRET missing or too short in .env");
  process.exit(1);
}

const generatePlayerToken = (user) => {
  return jwt.sign(
    {
      role: "player",
      profile_id: user.profile_id,
      email: user.email,
      token_version: Number(user.token_version || 0),
    },
    SUPPORT_JWT_SECRET,
    {
      expiresIn: "7d",
      issuer: "bgmi-user-server",
      audience: "bgmi-support",
      algorithm: "HS256",
    }
  );
};

// ==========================================
// ORIGINAL DEVICE INSTALLATION ID
// ==========================================

const getDeviceInfo = (req) => {
  const body = req.body || {};

  const cleanText = (value, maxLength = 250) => {
    if (typeof value !== "string") {
      return null;
    }

    const cleaned = value.trim();

    if (!cleaned) {
      return null;
    }

    return cleaned.slice(0, maxLength);
  };

  const cleanNumber = (value) => {
    const number = Number(value);

    if (!Number.isInteger(number) || number < 0 || number > 10000) {
      return null;
    }

    return number;
  };

  const installationId = cleanText(body.installationId, 200);

  const validInstallationId =
    installationId && installationId.length >= 16
      ? installationId
      : null;

  return {
    installationId: validInstallationId,

    deviceName: cleanText(body.deviceName, 100) || "Unknown device",

    operatingSystem: cleanText(body.operatingSystem, 100),

    osVersion: cleanText(body.osVersion, 100),

    browserName: cleanText(body.browserName, 100) || "Unknown browser",

    browserVersion: cleanText(body.browserVersion, 100),

    deviceType: cleanText(body.deviceType, 50),

    screenWidth: cleanNumber(body.screenWidth),

    screenHeight: cleanNumber(body.screenHeight),

    language: cleanText(body.language, 50),

    timezone: cleanText(body.timezone, 100),

    platform: cleanText(body.platform, 100),

    // Browser ka actual User-Agent request header se milega.
    userAgent: cleanText(req.get("user-agent"), 1000),

    // IP backend request se lega, frontend se nahi.
    ip: req.ip || null,
  };
};

// ==========================================
// CHECK BANNED DEVICE (raw installation_id only)
// ==========================================

const checkBannedDevice = async (installationId) => {
  if (
    typeof installationId !== "string" ||
    installationId.length < 16 ||
    installationId.length > 200
  ) {
    throw new Error("Valid installation ID is required");
  }

  const { data: bans, error } = await supabase
    .from("banned_devices")
    .select("id, reason, is_permanent, expires_at")
    .eq("installation_id", installationId);

  if (error) {
    throw new Error(`Device ban check failed: ${error.message}`);
  }

  const now = Date.now();

  for (const ban of bans || []) {
    const expired =
      ban.is_permanent === false &&
      ban.expires_at &&
      new Date(ban.expires_at).getTime() <= now;

    if (expired) {
      const { error: deleteError } = await supabase
        .from("banned_devices")
        .delete()
        .eq("id", ban.id);

      if (deleteError) {
        throw new Error(
          `Expired device ban cleanup failed: ${deleteError.message}`
        );
      }

      continue;
    }

    return {
      blocked: true,
      reason: ban.reason || "This device is restricted",
    };
  }

  return { blocked: false };
};

// ==========================================
// SAVE USER DEVICE (raw installation_id, no hash)
// ==========================================

const saveUserDevice = async (deviceInfo, profileId) => {
  if (
    !deviceInfo ||
    typeof deviceInfo.installationId !== "string" ||
    deviceInfo.installationId.length < 16
  ) {
    throw new Error("Valid installation ID is required for device history");
  }

  const { data: existing, error: findError } = await supabase
    .from("user_devices")
    .select("id")
    .eq("profile_id", profileId)
    .eq("installation_id", deviceInfo.installationId)
    .maybeSingle();

  if (findError) {
    throw new Error(`Device history lookup failed: ${findError.message}`);
  }

  const now = new Date().toISOString();

  const deviceRecord = {
    profile_id: profileId,
    installation_id: deviceInfo.installationId,

    device_name: deviceInfo.deviceName,
    browser_name: deviceInfo.browserName,
    last_ip: deviceInfo.ip,

    operating_system: deviceInfo.operatingSystem,
    os_version: deviceInfo.osVersion,
    browser_version: deviceInfo.browserVersion,
    device_type: deviceInfo.deviceType,
    screen_width: deviceInfo.screenWidth,
    screen_height: deviceInfo.screenHeight,
    language: deviceInfo.language,
    timezone: deviceInfo.timezone,
    platform: deviceInfo.platform,
    user_agent: deviceInfo.userAgent,

    last_seen: now,
  };

  if (existing) {
    const { error } = await supabase
      .from("user_devices")
      .update(deviceRecord)
      .eq("id", existing.id);

    if (error) {
      throw new Error(`Device history update failed: ${error.message}`);
    }

    console.log("USER DEVICE UPDATED:", profileId);
  } else {
    const { error } = await supabase
      .from("user_devices")
      .insert({
        ...deviceRecord,
        first_seen: now,
      });

    if (error) {
      throw new Error(`Device history insert failed: ${error.message}`);
    }

    console.log("USER DEVICE SAVED:", profileId);
  }

  console.log("RAW INSTALLATION ID SAVED:", deviceInfo.installationId);
};

// ==========================================
// ACCOUNT STATUS CHECK + AUTO REACTIVATION
// ==========================================

const checkAccountStatus = async (user) => {
  let currentUser = user;

  const status = currentUser.account_status || "active";

  if (status === "banned") {
    return {
      allowed: false,
      message: "Your account has been permanently banned.",
      user: currentUser,
    };
  }

  if (status === "suspended") {
    const expiry = currentUser.suspended_until
      ? new Date(currentUser.suspended_until).getTime()
      : null;

    // No expiry = indefinite suspension.
    if (!expiry || expiry > Date.now()) {
      return {
        allowed: false,
        message: "Your account is suspended.",
        user: currentUser,
      };
    }

    // Suspension expire ho chuki hai: account active karo.
    const newTokenVersion = Number(currentUser.token_version || 0) + 1;

    const { data: reactivatedUser, error } = await supabase
      .from("registeruser")
      .update({
        account_status: "active",
        suspended_until: null,
        suspension_reason: null,
        token_version: newTokenVersion,
      })
      .eq("profile_id", currentUser.profile_id)
      .select("*")
      .single();

    if (error || !reactivatedUser) {
      throw new Error(
        `Account reactivation failed: ${error?.message || "Unknown error"}`
      );
    }

    currentUser = reactivatedUser;
  }

  return {
    allowed: true,
    message: "Account active",
    user: currentUser,
  };
};

// ==========================================
// PLAYER AUTH MIDDLEWARE
// Every protected request checks DB status.
// ==========================================

const requirePlayer = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Login required",
      });
    }

    const decoded = jwt.verify(token, SUPPORT_JWT_SECRET, {
      issuer: "bgmi-user-server",
      audience: "bgmi-support",
      algorithms: ["HS256"],
    });

    if (decoded.role !== "player" || !decoded.profile_id) {
      return res.status(403).json({
        success: false,
        message: "Not allowed",
      });
    }

    const { data: user, error } = await supabase
      .from("registeruser")
      .select(
        "id, profile_id, email, account_status, suspended_until, suspension_reason, token_version"
      )
      .eq("profile_id", decoded.profile_id)
      .eq("email", decoded.email)
      .maybeSingle();

    if (error) {
      console.error("❌ PLAYER SECURITY CHECK:", error.message);

      return res.status(500).json({
        success: false,
        message: "Could not verify account security",
      });
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Account not found. Please login again.",
      });
    }

    const statusCheck = await checkAccountStatus(user);

    if (!statusCheck.allowed) {
      return res.status(403).json({
        success: false,
        message: statusCheck.message,
        account_status: statusCheck.user.account_status,
        suspended_until: statusCheck.user.suspended_until,
      });
    }

    const latestUser = statusCheck.user;

    // Suspension/ban/unsuspend ke baad old tokens reject honge.
    if (
      Number(decoded.token_version || 0) !==
      Number(latestUser.token_version || 0)
    ) {
      return res.status(401).json({
        success: false,
        message: "Your session has been revoked. Please login again.",
      });
    }

    req.player = {
      role: "player",
      profile_id: latestUser.profile_id,
      email: latestUser.email,
      token_version: latestUser.token_version || 0,
    };

    next();
  } catch (err) {
    console.error("❌ PLAYER AUTH ERROR:", err.message);

    return res.status(401).json({
      success: false,
      message: "Session expired or invalid. Please login again.",
    });
  }
};

// ==========================================
// AVATAR UPLOAD (multer - memory storage)
// ==========================================

const AVATAR_BUCKET = "BGMI";
const MAX_AVATAR_SIZE = 2 * 1024 * 1024; // 2MB

// public/avatars/avatar1.svg ... avatar12.svg
const DEFAULT_AVATAR_REGEX = /^\/avatars\/avatar([1-9]|1[0-2])\.svg$/;

const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_AVATAR_SIZE },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only JPG, PNG, WEBP or GIF images are allowed"));
    }
  },
}).single("avatar");

// multer errors ko JSON me return karne ke liye wrapper
const handleAvatarUpload = (req, res, next) => {
  avatarUpload(req, res, (err) => {
    if (!err) return next();

    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        success: false,
        message: "Image must be smaller than 2MB",
      });
    }

    return res.status(400).json({
      success: false,
      message: err.message || "Upload failed",
    });
  });
};

// ==========================================
// MIDDLEWARE
// ==========================================

app.use(
  cors({
    origin: true,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json());

// ==========================================
// ADMIN JWT AUTHENTICATION
// WITH INDIVIDUAL SESSION VALIDATION
// ==========================================

const ADMIN_JWT_SECRET = process.env.JWT_SECRET;

if (!ADMIN_JWT_SECRET || ADMIN_JWT_SECRET.length < 32) {
  console.error("JWT_SECRET missing or too short");
  process.exit(1);
}

const requireAdmin = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || "";

    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Admin login required",
      });
    }

    // STEP 1: Verify JWT
    const decoded = jwt.verify(token, ADMIN_JWT_SECRET);

    if (decoded.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Admin access only",
      });
    }

    // STEP 2: Check Session ID
    if (!decoded.sid) {
      return res.status(401).json({
        success: false,
        message: "Session ID missing. Please login again.",
      });
    }

    // STEP 3: Check session in Supabase
    const { data: session, error } = await supabase
      .from("admin_sessions")
      .select("id, admin_id, is_revoked")
      .eq("id", decoded.sid)
      .maybeSingle();

    if (error) {
      console.error("ADMIN SESSION CHECK ERROR:", error.message);

      return res.status(500).json({
        success: false,
        message: "Could not verify admin session",
      });
    }

    // STEP 4: Session must exist
    if (!session) {
      return res.status(401).json({
        success: false,
        message: "Admin session not found. Please login again.",
      });
    }

    // STEP 5: Reject revoked session
    if (session.is_revoked === true) {
      return res.status(401).json({
        success: false,
        message: "Your session has been revoked. Please login again.",
        code: "SESSION_REVOKED",
      });
    }

    // STEP 6: Allow request
    req.admin = decoded;

    next();
  } catch (err) {
    console.error("ADMIN AUTH ERROR:", err.message);

    return res.status(401).json({
      success: false,
      message: "Invalid or expired admin session",
    });
  }
};

// ==========================================
// USER COUNTER
// ==========================================

let userCounter = 8523;

// ==========================================
// REGISTRATION OTP STORAGE
// email -> { otp, expiresAt, attempts, sentAt, profileId, deviceInfo }
// ==========================================

const otpStore = new Map();

// ==========================================
// PASSWORD RESET OTP STORAGE
// email -> { otp, expiresAt, attempts, sentAt, profileId }
// ==========================================

const resetOtpStore = new Map();

// ==========================================
// OTP GENERATOR
// ==========================================

const generateOTP = () => {
  return randomInt(100000, 1000000).toString();
};

// ==========================================
// MAILJET EMAIL SENDER
// ==========================================

const sendMailjetEmail = async ({
  email,
  username,
  otp,
  subject,
  heading,
  message,
}) => {
  const safeUsername = String(username || "Player")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:500px;margin:auto;padding:20px;">
      <h2>${heading}</h2>
      <p>Hello <strong>${safeUsername}</strong>,</p>
      <p>${message}</p>
      <div style="font-size:32px;font-weight:bold;letter-spacing:8px;padding:15px;text-align:center;background:#f3f3f3;margin:20px 0;">
        ${otp}
      </div>
      <p>This OTP is valid for <strong>10 minutes</strong>.</p>
      <p>Do not share this OTP with anyone.</p>
      <p>Regards,<br><strong>BGMI Esports</strong></p>
    </div>
  `;

  const text = `
BGMI Esports

Hello ${username || "Player"},

${message}

Your OTP is: ${otp}

This OTP is valid for 10 minutes.
Do not share this OTP with anyone.

Regards,
BGMI Esports
  `;

  const auth = Buffer.from(
    `${MAILJET_API_KEY}:${MAILJET_SECRET_KEY}`
  ).toString("base64");

  const response = await fetch("https://api.mailjet.com/v3.1/send", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      Messages: [
        {
          From: {
            Email: MAILJET_SENDER_EMAIL,
            Name: "BGMI Esports",
          },
          To: [
            {
              Email: email,
              Name: safeUsername,
            },
          ],
          Subject: subject,
          TextPart: text,
          HTMLPart: html,
        },
      ],
    }),
  });

  const result = await response.json();

  if (!response.ok) {
    console.error("❌ MAILJET API ERROR:", result);
    throw new Error(
      result?.Messages?.[0]?.Errors?.[0]?.ErrorMessage ||
        `Mailjet request failed: ${response.status}`
    );
  }

  console.log("✅ MAILJET EMAIL SENT:", email);

  return result;
};

// ==========================================
// SEND REGISTRATION OTP
// ==========================================

const sendOTPEmail = async ({ email, username, otp }) => {
  return sendMailjetEmail({
    email,
    username,
    otp,
    subject: "BGMI Esports - Email Verification OTP",
    heading: "BGMI Esports Email Verification",
    message: "Your email verification OTP is:",
  });
};

// ==========================================
// SEND PASSWORD RESET OTP
// ==========================================

const sendPasswordResetEmail = async ({ email, username, otp }) => {
  return sendMailjetEmail({
    email,
    username,
    otp,
    subject: "BGMI Esports - Password Reset OTP",
    heading: "BGMI Esports Password Reset",
    message: "Your password reset OTP is:",
  });
};

// ==========================================
// MY BALANCE
// ==========================================

app.get("/api/my-balance", async (req, res) => {
  try {
    const { profileId } = req.query;

    if (!profileId) {
      console.log("❌ No profileId provided for balance");
      return res.json({ balance: 0 });
    }

    const { data, error } = await supabase
      .from("registeruser")
      .select("balance")
      .eq("profile_id", profileId)
      .single();

    if (error) {
      console.error("❌ BALANCE FETCH ERROR:", error.message);
      return res.json({ balance: 0 });
    }

    const balance = data?.balance || 0;

    console.log("💰 BALANCE FETCH:", profileId, "→ ₹", balance);

    res.json({ balance });
  } catch (err) {
    console.error("❌ BALANCE ERROR:", err);
    res.json({ balance: 0 });
  }
});

// ==========================================
// INITIALIZE COUNTER
// ==========================================

const initCounter = async () => {
  try {
    const { data, error } = await supabase
      .from("registeruser")
      .select("profile_id")
      .order("id", { ascending: false })
      .limit(1);

    if (error) {
      console.log("⚠️ Counter fetch error:", error.message);
      return;
    }

    if (data && data[0]) {
      const lastId = data[0].profile_id?.match(/^(?:FF|BGMI)-(\d+)$/)?.[1];

      if (lastId) {
        userCounter = parseInt(lastId, 10) + 1;

        console.log(
          `🔄 Counter set to: BGMI-${userCounter.toString().padStart(4, "0")}`
        );

        return;
      }
    }

    console.log("🔄 No existing users, starting from BGMI-8523");
  } catch (err) {
    console.log("⚠️ Counter init failed, using default:", userCounter);
  }
};

// ==========================================
// REGISTER
// ==========================================

app.post("/api/register", async (req, res) => {
  try {
    const { email, username, password } = req.body;

    // DEVICE RESTRICTION CHECK
    const deviceInfo = getDeviceInfo(req);

    if (!deviceInfo.installationId) {
      return res.status(400).json({
        success: false,
        error: "Valid installation ID is required.",
      });
    }

    const deviceCheck = await checkBannedDevice(deviceInfo.installationId);

    if (deviceCheck.blocked) {
      return res.status(403).json({
        success: false,
        error: "Registration blocked on this device.",
        message: deviceCheck.reason,
      });
    }

    console.log("📥 Register attempt:", { email, username });

    if (!email || !username || !password) {
      return res.status(400).json({
        error: "Email, username & password required",
      });
    }

    const cleanEmail = email.toLowerCase().trim();
    const cleanUsername = username.trim();
    const cleanPassword = password.trim();

    // --------------------------------------
    // CHECK EXISTING USER
    // --------------------------------------

    const { data: existingUser, error: existingUserError } = await supabase
      .from("registeruser")
      .select("id, profile_id, verified")
      .eq("email", cleanEmail)
      .maybeSingle();

    if (existingUserError) {
      console.error("💥 Existing user check error:", existingUserError.message);

      return res.status(500).json({
        error: existingUserError.message,
      });
    }

    if (existingUser) {
      if (!existingUser.verified) {
        return res.status(400).json({
          error: "Email registered but not verified. Please request a new OTP.",
        });
      }

      return res.status(400).json({
        error: "Email already registered",
      });
    }

    // --------------------------------------
    // GENERATE PROFILE ID
    // --------------------------------------

    let profile_id = null;
    let attempts = 0;

    while (attempts < 100) {
      const generatedId = `BGMI-${userCounter.toString().padStart(4, "0")}`;

      userCounter++;

      const { data: profileCheck, error: profileCheckError } = await supabase
        .from("registeruser")
        .select("id")
        .eq("profile_id", generatedId)
        .maybeSingle();

      if (profileCheckError) {
        console.error("💥 Profile check error:", profileCheckError.message);

        return res.status(500).json({
          error: profileCheckError.message,
        });
      }

      if (!profileCheck) {
        profile_id = generatedId;
        break;
      }

      attempts++;
    }

    if (!profile_id) {
      return res.status(500).json({
        error: "ID generation failed",
      });
    }

    // --------------------------------------
    // IST TIME
    // --------------------------------------

    const istTime = new Date().toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
    });

    // --------------------------------------
    // INSERT UNVERIFIED USER (plain password)
    // --------------------------------------

    const { error: supaErr } = await supabase.from("registeruser").insert([
      {
        profile_id,
        username: cleanUsername,
        email: cleanEmail,
        "User Password": cleanPassword,
        balance: 0,
        register_time_ist: istTime,
        verified: false,

        account_status: "active",
        suspended_until: null,
        suspension_reason: null,
        token_version: 0,
      },
    ]);

    if (supaErr) {
      console.error("💥 Supabase ERROR:", supaErr.message);

      return res.status(500).json({
        error: `DB Error: ${supaErr.message}`,
      });
    }

    // --------------------------------------
    // GENERATE OTP
    // --------------------------------------

    const otp = generateOTP();
    const now = Date.now();

    otpStore.set(cleanEmail, {
      otp,
      expiresAt: now + 10 * 60 * 1000,
      attempts: 0,
      sentAt: now,
      profileId: profile_id,

      // Registration ke original device ki details OTP ke saath bind
      deviceInfo,
    });

    // --------------------------------------
    // SEND EMAIL
    // --------------------------------------

    try {
      await sendOTPEmail({
        email: cleanEmail,
        username: cleanUsername,
        otp,
      });
    } catch (emailError) {
      console.error("❌ OTP EMAIL FAILED:", emailError.message);

      // Rollback user if email failed
      await supabase.from("registeruser").delete().eq("profile_id", profile_id);

      otpStore.delete(cleanEmail);

      return res.status(500).json({
        error: "Account could not be created because verification email failed.",
      });
    }

    console.log("✅ USER CREATED - OTP SENT:", profile_id, cleanEmail);

    res.json({
      success: true,
      requiresVerification: true,
      message: "OTP sent to your email",
      user: {
        profile_id,
        username: cleanUsername,
        email: cleanEmail,
        balance: 0,
        verified: false,
      },
    });
  } catch (err) {
    console.error("💥 Register CRASH:", err);

    res.status(500).json({
      error: "Server error",
    });
  }
});

// ==========================================
// VERIFY REGISTRATION OTP
// ==========================================

app.post("/api/verify-otp", async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({
        error: "Email and OTP required",
      });
    }

    const cleanEmail = email.toLowerCase().trim();
    const cleanOtp = otp.toString().trim();

    const stored = otpStore.get(cleanEmail);

    if (!stored) {
      return res.status(400).json({
        error: "OTP not found. Please request a new OTP.",
      });
    }

    // --------------------------------------
    // SAME DEVICE VERIFICATION
    // --------------------------------------

    const currentDeviceInfo = getDeviceInfo(req);

    if (!currentDeviceInfo.installationId) {
      return res.status(400).json({
        success: false,
        error: "Valid installation ID is required.",
      });
    }

    if (
      !stored.deviceInfo ||
      stored.deviceInfo.installationId !== currentDeviceInfo.installationId
    ) {
      return res.status(403).json({
        success: false,
        error: "OTP verification must be completed on the registered device.",
      });
    }

    // OTP verification se pehle device ban dobara check karo
    const deviceCheck = await checkBannedDevice(
      stored.deviceInfo.installationId
    );

    if (deviceCheck.blocked) {
      return res.status(403).json({
        success: false,
        error: "OTP verification blocked on this device.",
        message: deviceCheck.reason,
      });
    }

    if (Date.now() > stored.expiresAt) {
      otpStore.delete(cleanEmail);

      return res.status(400).json({
        error: "OTP expired. Please request a new OTP.",
      });
    }

    if (stored.attempts >= 5) {
      otpStore.delete(cleanEmail);

      return res.status(429).json({
        error: "Too many incorrect attempts. Please request a new OTP.",
      });
    }

    if (cleanOtp !== stored.otp) {
      stored.attempts += 1;

      return res.status(400).json({
        error: `Invalid OTP. Attempts left: ${5 - stored.attempts}`,
      });
    }

    // --------------------------------------
    // UPDATE VERIFIED
    // --------------------------------------

    const { data: verifiedUser, error: verifyError } = await supabase
      .from("registeruser")
      .update({
        verified: true,
      })
      .eq("email", cleanEmail)
      .eq("profile_id", stored.profileId)
      .select("*")
      .single();

    if (verifyError || !verifiedUser) {
      console.error("❌ VERIFY DB ERROR:", verifyError?.message);

      return res.status(500).json({
        error: "Could not verify account",
      });
    }

    const statusCheck = await checkAccountStatus(verifiedUser);

    if (!statusCheck.allowed) {
      return res.status(403).json({
        success: false,
        error: statusCheck.message,
      });
    }

    const finalUser = statusCheck.user;

    // Registration ke original device ki details save hongi
    await saveUserDevice(stored.deviceInfo, finalUser.profile_id);

    otpStore.delete(cleanEmail);

    const { "User Password": _password, ...safeUser } = finalUser;

    const responseUser = {
      ...safeUser,
      token: generatePlayerToken(finalUser),
    };

    console.log("✅ EMAIL VERIFIED:", verifiedUser.profile_id, cleanEmail);

    res.json({
      success: true,
      message: "Email verified successfully",
      user: responseUser,
    });
  } catch (err) {
    console.error("💥 Verify OTP CRASH:", err);

    res.status(500).json({
      error: "Verification failed",
    });
  }
});

// ==========================================
// RESEND REGISTRATION OTP
// ==========================================

app.post("/api/resend-otp", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        error: "Email required",
      });
    }

    const cleanEmail = email.toLowerCase().trim();

    // --------------------------------------
    // FIND USER
    // --------------------------------------

    const { data: user, error } = await supabase
      .from("registeruser")
      .select("profile_id, username, verified")
      .eq("email", cleanEmail)
      .maybeSingle();

    if (error) {
      return res.status(500).json({
        error: error.message,
      });
    }

    if (!user) {
      return res.status(404).json({
        error: "User not found",
      });
    }

    if (user.verified) {
      return res.status(400).json({
        error: "Email is already verified",
      });
    }

    // --------------------------------------
    // ORIGINAL DEVICE BINDING CHECK
    // --------------------------------------

    const previous = otpStore.get(cleanEmail);

    const currentDeviceInfo = getDeviceInfo(req);

    if (!currentDeviceInfo.installationId) {
      return res.status(400).json({
        success: false,
        error: "Valid installation ID is required.",
      });
    }

    if (
      !previous ||
      !previous.deviceInfo ||
      previous.deviceInfo.installationId !== currentDeviceInfo.installationId
    ) {
      return res.status(403).json({
        success: false,
        error: "OTP resend must be requested from the registered device.",
      });
    }

    const deviceCheck = await checkBannedDevice(
      previous.deviceInfo.installationId
    );

    if (deviceCheck.blocked) {
      return res.status(403).json({
        success: false,
        error: "OTP resend blocked on this device.",
        message: deviceCheck.reason,
      });
    }

    // --------------------------------------
    // RESEND LIMIT
    // --------------------------------------

    if (Date.now() - previous.sentAt < 60 * 1000) {
      return res.status(429).json({
        error: "Please wait 60 seconds before requesting another OTP.",
      });
    }

    // --------------------------------------
    // NEW OTP
    // --------------------------------------

    const otp = generateOTP();
    const now = Date.now();

    otpStore.set(cleanEmail, {
      otp,
      expiresAt: now + 10 * 60 * 1000,
      attempts: 0,
      sentAt: now,
      profileId: user.profile_id,
      deviceInfo: previous.deviceInfo,
    });

    await sendOTPEmail({
      email: cleanEmail,
      username: user.username,
      otp,
    });

    console.log("🔄 OTP RESENT:", cleanEmail);

    res.json({
      success: true,
      message: "New OTP sent to your email",
    });
  } catch (err) {
    console.error("💥 RESEND OTP CRASH:", err);

    res.status(500).json({
      error: "Could not resend OTP",
    });
  }
});

// ==========================================
// FORGOT PASSWORD - SEND RESET OTP
// ==========================================

app.post("/api/forgot-password", async (req, res) => {
  try {
    const email = req.body.email?.toLowerCase().trim();

    if (!email) {
      return res.status(400).json({
        error: "Email required",
      });
    }

    const { data: user, error } = await supabase
      .from("registeruser")
      .select("profile_id, username, email, verified")
      .eq("email", email)
      .maybeSingle();

    if (error) {
      console.error("❌ FORGOT PASSWORD DB ERROR:", error.message);

      return res.status(500).json({
        error: "Could not process password reset",
      });
    }

    if (!user || !user.verified) {
      return res.status(404).json({
        error: "No verified account found with this email",
      });
    }

    // --------------------------------------
    // RESEND COOLDOWN
    // --------------------------------------

    const previous = resetOtpStore.get(email);

    if (previous && Date.now() - previous.sentAt < 60 * 1000) {
      return res.status(429).json({
        error: "Please wait 60 seconds before requesting another OTP",
      });
    }

    // --------------------------------------
    // GENERATE RESET OTP
    // --------------------------------------

    const otp = generateOTP();
    const now = Date.now();

    resetOtpStore.set(email, {
      otp,
      expiresAt: now + 10 * 60 * 1000,
      sentAt: now,
      attempts: 0,
      profileId: user.profile_id,
    });

    // --------------------------------------
    // SEND RESET EMAIL
    // --------------------------------------

    try {
      await sendPasswordResetEmail({
        email,
        username: user.username,
        otp,
      });
    } catch (emailError) {
      console.error("❌ PASSWORD RESET EMAIL FAILED:", emailError.message);

      resetOtpStore.delete(email);

      return res.status(500).json({
        error: "Could not send password reset email",
      });
    }

    console.log("🔐 PASSWORD RESET OTP SENT:", email);

    return res.json({
      success: true,
      message: "Password reset OTP sent to your email",
    });
  } catch (err) {
    console.error("💥 FORGOT PASSWORD CRASH:", err);

    return res.status(500).json({
      error: "Could not process password reset",
    });
  }
});

// ==========================================
// RESET PASSWORD - VERIFY OTP AND UPDATE
// ==========================================

app.post("/api/reset-password", async (req, res) => {
  try {
    const email = req.body.email?.toLowerCase().trim();
    const otp = req.body.otp?.toString().trim();
    const newPassword = req.body.newPassword?.trim();

    if (!email || !otp || !newPassword) {
      return res.status(400).json({
        error: "Email, OTP and new password are required",
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        error: "Password must be at least 8 characters long",
      });
    }

    const stored = resetOtpStore.get(email);

    if (!stored) {
      return res.status(400).json({
        error: "Reset OTP not found. Please request a new OTP.",
      });
    }

    // OTP EXPIRY
    if (Date.now() > stored.expiresAt) {
      resetOtpStore.delete(email);

      return res.status(400).json({
        error: "OTP expired. Please request a new OTP.",
      });
    }

    // MAX ATTEMPTS
    if (stored.attempts >= 5) {
      resetOtpStore.delete(email);

      return res.status(429).json({
        error: "Too many incorrect attempts. Please request a new OTP.",
      });
    }

    // CHECK OTP
    if (otp !== stored.otp) {
      stored.attempts += 1;

      return res.status(400).json({
        error: `Invalid OTP. Attempts left: ${5 - stored.attempts}`,
      });
    }

    // --------------------------------------
    // UPDATE PASSWORD (plain, same format)
    // --------------------------------------

    const { data: updatedUser, error: updateError } = await supabase
      .from("registeruser")
      .update({
        "User Password": newPassword,
      })
      .eq("email", email)
      .eq("profile_id", stored.profileId)
      .eq("verified", true)
      .select("profile_id")
      .single();

    if (updateError || !updatedUser) {
      console.error("❌ RESET PASSWORD DB ERROR:", updateError?.message);

      return res.status(500).json({
        error: "Could not update password",
      });
    }

    // OTP is removed after successful password reset
    resetOtpStore.delete(email);

    console.log("✅ PASSWORD RESET SUCCESS:", updatedUser.profile_id);

    return res.json({
      success: true,
      message: "Password reset successfully. Please login.",
    });
  } catch (err) {
    console.error("💥 RESET PASSWORD CRASH:", err);

    return res.status(500).json({
      error: "Password reset failed",
    });
  }
});

// ==========================================
// LOGIN
// ==========================================

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: "Email and password required",
      });
    }

    // DEVICE BAN CHECK
    const deviceInfo = getDeviceInfo(req);

    if (!deviceInfo.installationId) {
      return res.status(400).json({
        success: false,
        error: "Valid installation ID is required.",
      });
    }

    const deviceCheck = await checkBannedDevice(deviceInfo.installationId);

    if (deviceCheck.blocked) {
      return res.status(403).json({
        success: false,
        error: "Login blocked on this device.",
        message: deviceCheck.reason,
      });
    }

    // FIND USER
    const { data: user, error } = await supabase
      .from("registeruser")
      .select("*")
      .eq("email", email.toLowerCase().trim())
      .maybeSingle();

    if (error) {
      console.error("❌ LOGIN DB ERROR:", error.message);

      return res.status(500).json({
        success: false,
        error: "Login could not be processed",
      });
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    // Plain password compare
    if ((user["User Password"] || "").trim() !== password.trim()) {
      return res.status(401).json({
        success: false,
        error: "Invalid password",
      });
    }

    if (!user.verified) {
      return res.status(403).json({
        success: false,
        error: "Email not verified. Please verify your email with OTP.",
        requiresVerification: true,
        email: user.email,
      });
    }

    // ACCOUNT SUSPENSION / BAN CHECK
    const statusCheck = await checkAccountStatus(user);

    if (!statusCheck.allowed) {
      return res.status(403).json({
        success: false,
        error: statusCheck.message,
        account_status: statusCheck.user.account_status,
        suspended_until: statusCheck.user.suspended_until,
        suspension_reason: statusCheck.user.suspension_reason,
      });
    }

    const activeUser = statusCheck.user;

    // DEVICE HISTORY
    await saveUserDevice(deviceInfo, activeUser.profile_id);

    // Password response mein kabhi nahi bhejna
    const { "User Password": _password, ...safeUser } = activeUser;

    return res.json({
      success: true,
      user: {
        ...safeUser,
        token: generatePlayerToken(activeUser),
      },
    });
  } catch (err) {
    console.error("💥 Login CRASH:", err);

    return res.status(500).json({
      success: false,
      error: "Login failed",
    });
  }
});

// ==========================================
// MY PROFILE (fresh user data using token)
// Requires: Authorization: Bearer <player token>
// ==========================================

app.get("/api/my-profile", requirePlayer, async (req, res) => {
  try {
    const { email, profile_id } = req.player;

    const { data: user, error } = await supabase
      .from("registeruser")
      .select("*")
      .eq("email", email)
      .eq("profile_id", profile_id)
      .single();

    if (error || !user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Password kabhi response me nahi bhejna
    const { "User Password": _pw, ...safeUser } = user;

    res.json({
      success: true,
      user: safeUser,
    });
  } catch (err) {
    console.error("💥 MY PROFILE CRASH:", err);

    res.status(500).json({
      success: false,
      message: "Could not load profile",
    });
  }
});

// ==========================================
// UPDATE PROFILE PICTURE (default avatar OR custom upload)
// Requires: Authorization: Bearer <player token>
// ==========================================

app.post(
  "/api/update-profile-pic",
  requirePlayer,
  handleAvatarUpload,
  async (req, res) => {
    try {
      // Email token se aata hai, body se nahi (secure)
      const { email, profile_id } = req.player;
      const { avatarUrl } = req.body || {};

      let avatar;

      if (req.file) {
        // CUSTOM UPLOAD -> Supabase Storage
        const ext =
          path.extname(req.file.originalname || "").toLowerCase() || ".png";

        const fileName = `${profile_id}-${Date.now()}${ext}`;

        const { error: uploadError } = await supabase.storage
          .from(AVATAR_BUCKET)
          .upload(fileName, req.file.buffer, {
            contentType: req.file.mimetype,
            upsert: false,
          });

        if (uploadError) {
          console.error("❌ AVATAR UPLOAD ERROR:", uploadError.message);

          return res.status(500).json({
            success: false,
            message: "Image upload failed",
          });
        }

        const { data: publicData } = supabase.storage
          .from(AVATAR_BUCKET)
          .getPublicUrl(fileName);

        avatar = publicData.publicUrl;
      } else if (
        typeof avatarUrl === "string" &&
        DEFAULT_AVATAR_REGEX.test(avatarUrl)
      ) {
        // DEFAULT GAMING AVATAR (sirf app ke apne)
        avatar = avatarUrl;
      } else {
        return res.status(400).json({
          success: false,
          message: "Invalid avatar",
        });
      }

      // SAVE IN DB
      const { error: updateError } = await supabase
        .from("registeruser")
        .update({ avatar })
        .eq("email", email)
        .eq("profile_id", profile_id);

      if (updateError) {
        console.error("❌ AVATAR DB ERROR:", updateError.message);

        return res.status(500).json({
          success: false,
          message: "Could not save profile picture",
        });
      }

      console.log("🖼️ AVATAR UPDATED:", profile_id);

      res.json({
        success: true,
        avatar,
      });
    } catch (err) {
      console.error("💥 UPDATE PROFILE PIC CRASH:", err);

      res.status(500).json({
        success: false,
        message: "Server error",
      });
    }
  }
);

// ==========================================
// ADMIN USERS
// ==========================================

// GET ALL USERS FOR ADMIN
app.get("/api/admin/users", requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("registeruser")
      .select(`
        id,
        profile_id,
        username,
        email,
        verified,
        account_status,
        suspended_until,
        suspension_reason,
        token_version
      `)
      .order("id", { ascending: false });

    if (error) {
      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }

    return res.json({
      success: true,
      users: data || [],
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// ==========================================
// DELETE USER
// ==========================================

app.delete("/api/admin/users/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    console.log("🗑️ DELETE user:", id);

    const { error } = await supabase.from("registeruser").delete().eq("id", id);

    if (error) {
      console.error("💥 Delete ERROR:", error.message);

      return res.status(500).json({
        error: error.message,
      });
    }

    console.log("✅ User deleted:", id);

    res.json({
      success: true,
    });
  } catch (err) {
    console.error("💥 Delete CRASH:", err);

    res.status(500).json({
      error: "Delete failed",
    });
  }
});

// ==========================================
// HEALTH CHECK
// ==========================================

app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    myBalance: "✅ ACTIVE",
    otp: "✅ ACTIVE",
    passwordReset: "✅ ACTIVE",
    profilePic: "✅ ACTIVE",
    port: 5001,
  });
});

// ==========================================
// START SERVER
// ==========================================

const PORT = process.env.PORT || 5001;

initCounter().then(() => {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`🔥 BGMI USER SERVER (5001) running on port ${PORT}`);

    console.log("✅ Supabase connected");
    console.log("✅ CORS active");
    console.log("✅ MY-BALANCE endpoint active");
    console.log("✅ OTP verification active");
    console.log("✅ Password reset endpoints active");
    console.log("✅ Mailjet API email service configured");
    console.log("✅ Admin users endpoint active");
    console.log("✅ Profile picture upload active");

    console.log(`✅ Test: http://localhost:${PORT}/health`);
  });
});