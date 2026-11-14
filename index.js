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

const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseKey) {
  console.error("❌ SUPABASE_ANON_KEY missing in .env");
  process.exit(1);
}

const brevoApiKey = process.env.BREVO_API_KEY;
const brevoSenderEmail = process.env.BREVO_SENDER_EMAIL;
const brevoSenderName = process.env.BREVO_SENDER_NAME || "BGMI Esports";

if (!brevoApiKey || !brevoSenderEmail) {
  console.error("❌ Brevo configuration missing in .env");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const app = express();


// ==========================================
// PLAYER JWT AUTHENTICATION
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
// PLAYER AUTH MIDDLEWARE (verifies Bearer token)
// ==========================================

const requirePlayer = (req, res, next) => {
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

    if (decoded.role !== "player") {
      return res.status(403).json({
        success: false,
        message: "Not allowed",
      });
    }

    req.player = decoded;
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      message: "Session expired. Please login again.",
    });
  }
};

// ==========================================
// AVATAR UPLOAD (multer - memory storage)
// ==========================================

const AVATAR_BUCKET = "BGMI";
const MAX_AVATAR_SIZE = 2 * 1024 * 1024; // 2MB

// public/avatars/avatar1.png ... avatar12.png
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
// USER COUNTER
// ==========================================

let userCounter = 8523;

// ==========================================
// REGISTRATION OTP STORAGE
// ==========================================

const otpStore = new Map();

/*
otpStore structure:

email -> {
  otp: "123456",
  expiresAt: timestamp,
  attempts: 0,
  sentAt: timestamp,
  profileId: "FF-8523"
}
*/

// ==========================================
// PASSWORD RESET OTP STORAGE
// ==========================================

const resetOtpStore = new Map();

/*
resetOtpStore structure:

email -> {
  otp: "123456",
  expiresAt: timestamp,
  attempts: 0,
  sentAt: timestamp,
  profileId: "FF-8523"
}
*/

// ==========================================
// OTP GENERATOR
// ==========================================

const generateOTP = () => {
  return randomInt(100000, 1000000).toString();
};

// ==========================================
// SEND REGISTRATION OTP WITH BREVO
// ==========================================

const sendOTPEmail = async ({ email, username, otp }) => {
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      accept: "application/json",
      "api-key": brevoApiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      sender: {
        name: brevoSenderName,
        email: brevoSenderEmail,
      },
      to: [
        {
          email,
          name: username,
        },
      ],
      subject: "BGMI Esports - Email Verification OTP",
      htmlContent: `
        <div style="font-family:Arial,sans-serif;max-width:500px;margin:auto;padding:20px;">
          <h2>BGMI Esports Email Verification</h2>

          <p>Hello <strong>${username}</strong>,</p>

          <p>Your email verification OTP is:</p>

          <div style="
            font-size:32px;
            font-weight:bold;
            letter-spacing:8px;
            padding:15px;
            text-align:center;
            background:#f3f3f3;
            margin:20px 0;
          ">
            ${otp}
          </div>

          <p>This OTP is valid for <strong>10 minutes</strong>.</p>

          <p>Do not share this OTP with anyone.</p>

          <p>
            Regards,<br>
            <strong>BGMI Esports</strong>
          </p>
        </div>
      `,
      textContent: `
BGMI Esports Email Verification

Hello ${username},

Your email verification OTP is: ${otp}

This OTP is valid for 10 minutes.

Do not share this OTP with anyone.

Regards,
BGMI Esports
      `,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();

    console.error("❌ BREVO ERROR:", errorText);

    throw new Error("Unable to send verification email");
  }

  const result = await response.json();

  console.log("✅ OTP EMAIL SENT:", result?.messageId);

  return result;
};

// ==========================================
// SEND PASSWORD RESET OTP WITH BREVO
// ==========================================

const sendPasswordResetEmail = async ({ email, username, otp }) => {
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      accept: "application/json",
      "api-key": brevoApiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      sender: {
        name: brevoSenderName,
        email: brevoSenderEmail,
      },
      to: [
        {
          email,
          name: username,
        },
      ],
      subject: "BGMI Esports - Password Reset OTP",
      htmlContent: `
        <div style="font-family:Arial,sans-serif;max-width:500px;margin:auto;padding:20px;">
          <h2>BGMI Esports Password Reset</h2>

          <p>Hello <strong>${username}</strong>,</p>

          <p>Your password reset OTP is:</p>

          <div style="
            font-size:32px;
            font-weight:bold;
            letter-spacing:8px;
            padding:15px;
            text-align:center;
            background:#f3f3f3;
            margin:20px 0;
          ">
            ${otp}
          </div>

          <p>This OTP is valid for <strong>10 minutes</strong>.</p>

          <p>
            If you did not request a password reset,
            please ignore this email.
          </p>

          <p>
            Regards,<br>
            <strong>BGMI Esports</strong>
          </p>
        </div>
      `,
      textContent: `
BGMI Esports Password Reset

Hello ${username},

Your password reset OTP is: ${otp}

This OTP is valid for 10 minutes.

If you did not request a password reset, please ignore this email.

Regards,
BGMI Esports
      `,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();

    console.error("❌ BREVO RESET EMAIL ERROR:", errorText);

    throw new Error("Unable to send password reset email");
  }

  const result = await response.json();

  console.log("✅ PASSWORD RESET EMAIL SENT:", result?.messageId);

  return result;
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
  `🔄 Counter set to: BGMI-${userCounter
    .toString()
    .padStart(4, "0")}`
);

        return;
      }
    }

    console.log("🔄 No existing users, starting from BGMI-8523");
  } catch (err) {
    console.log(
      "⚠️ Counter init failed, using default:",
      userCounter
    );
  }
};

// ==========================================
// REGISTER
// ==========================================

app.post("/api/register", async (req, res) => {
  try {
    const { email, username, password } = req.body;

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

    const {
      data: existingUser,
      error: existingUserError,
    } = await supabase
      .from("registeruser")
      .select("id, profile_id, verified")
      .eq("email", cleanEmail)
      .maybeSingle();

    if (existingUserError) {
      console.error(
        "💥 Existing user check error:",
        existingUserError.message
      );

      return res.status(500).json({
        error: existingUserError.message,
      });
    }

    if (existingUser) {
      if (!existingUser.verified) {
        return res.status(400).json({
          error:
            "Email registered but not verified. Please use Resend OTP.",
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
      const generatedId = `BGMI-${userCounter
  .toString()
  .padStart(4, "0")}`;

      userCounter++;

      const {
        data: profileCheck,
        error: profileCheckError,
      } = await supabase
        .from("registeruser")
        .select("id")
        .eq("profile_id", generatedId)
        .maybeSingle();

      if (profileCheckError) {
        console.error(
          "💥 Profile check error:",
          profileCheckError.message
        );

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
    // INSERT UNVERIFIED USER
    // --------------------------------------

    const { error: supaErr } = await supabase
      .from("registeruser")
      .insert([
        {
          profile_id,
          username: cleanUsername,
          email: cleanEmail,
          "User Password": cleanPassword,
          balance: 0,
          register_time_ist: istTime,
          verified: false,
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
      console.error(
        "❌ OTP EMAIL FAILED:",
        emailError.message
      );

      // Rollback user if email failed
      await supabase
        .from("registeruser")
        .delete()
        .eq("profile_id", profile_id);

      otpStore.delete(cleanEmail);

      return res.status(500).json({
        error:
          "Account could not be created because verification email failed.",
      });
    }

    console.log(
      "✅ USER CREATED - OTP SENT:",
      profile_id,
      cleanEmail
    );

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

    if (Date.now() > stored.expiresAt) {
      otpStore.delete(cleanEmail);

      return res.status(400).json({
        error: "OTP expired. Please request a new OTP.",
      });
    }

    if (stored.attempts >= 5) {
      otpStore.delete(cleanEmail);

      return res.status(429).json({
        error:
          "Too many incorrect attempts. Please request a new OTP.",
      });
    }

    if (cleanOtp !== stored.otp) {
      stored.attempts += 1;

      return res.status(400).json({
        error: `Invalid OTP. Attempts left: ${
          5 - stored.attempts
        }`,
      });
    }

    // --------------------------------------
    // UPDATE VERIFIED
    // --------------------------------------

    const { data: verifiedUser, error: verifyError } =
      await supabase
        .from("registeruser")
        .update({
          verified: true,
        })
        .eq("email", cleanEmail)
        .eq("profile_id", stored.profileId)
        .select("*")
        .single();

    if (verifyError || !verifiedUser) {
      console.error(
        "❌ VERIFY DB ERROR:",
        verifyError?.message
      );

      return res.status(500).json({
        error: "Could not verify account",
      });
    }

    otpStore.delete(cleanEmail);

    const user = {
  ...verifiedUser,
  token: generatePlayerToken(verifiedUser),
};

    console.log(
      "✅ EMAIL VERIFIED:",
      verifiedUser.profile_id,
      cleanEmail
    );

    res.json({
      success: true,
      message: "Email verified successfully",
      user,
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
    // RESEND LIMIT
    // --------------------------------------

    const previous = otpStore.get(cleanEmail);

    if (
      previous &&
      Date.now() - previous.sentAt < 60 * 1000
    ) {
      return res.status(429).json({
        error:
          "Please wait 60 seconds before requesting another OTP.",
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

    if (
      previous &&
      Date.now() - previous.sentAt < 60 * 1000
    ) {
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
      console.error(
        "❌ PASSWORD RESET EMAIL FAILED:",
        emailError.message
      );

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

    // --------------------------------------
    // OTP EXPIRY
    // --------------------------------------

    if (Date.now() > stored.expiresAt) {
      resetOtpStore.delete(email);

      return res.status(400).json({
        error: "OTP expired. Please request a new OTP.",
      });
    }

    // --------------------------------------
    // MAX ATTEMPTS
    // --------------------------------------

    if (stored.attempts >= 5) {
      resetOtpStore.delete(email);

      return res.status(429).json({
        error: "Too many incorrect attempts. Please request a new OTP.",
      });
    }

    // --------------------------------------
    // CHECK OTP
    // --------------------------------------

    if (otp !== stored.otp) {
      stored.attempts += 1;

      return res.status(400).json({
        error: `Invalid OTP. Attempts left: ${
          5 - stored.attempts
        }`,
      });
    }

    // --------------------------------------
    // UPDATE PASSWORD
    // Existing password format remains unchanged
    // --------------------------------------

    const { data: updatedUser, error: updateError } =
      await supabase
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
      console.error(
        "❌ RESET PASSWORD DB ERROR:",
        updateError?.message
      );

      return res.status(500).json({
        error: "Could not update password",
      });
    }

    // OTP is removed after successful password reset
    resetOtpStore.delete(email);

    console.log(
      "✅ PASSWORD RESET SUCCESS:",
      updatedUser.profile_id
    );

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

    if (!email) {
      return res.status(400).json({
        error: "Email required",
      });
    }

    if (!password) {
      return res.status(400).json({
        error: "Password required",
      });
    }

    const { data: user, error } = await supabase
      .from("registeruser")
      .select("*")
      .eq("email", email.toLowerCase().trim())
      .single();

    if (error || !user) {
      return res.status(404).json({
        error: "User not found",
      });
    }

    if (
      (user["User Password"] || "").trim() !==
      password.trim()
    ) {
      return res.status(401).json({
        error: "Invalid password",
      });
    }

    // --------------------------------------
    // EMAIL VERIFICATION CHECK
    // --------------------------------------

    if (!user.verified) {
      return res.status(403).json({
        error:
          "Email not verified. Please verify your email with OTP.",
        requiresVerification: true,
        email: user.email,
      });
    }

    res.json({
      success: true,
      user: {
        ...user,
        token: generatePlayerToken(user),
      },
    });
  } catch (err) {
    console.error("💥 Login CRASH:", err);

    res.status(500).json({
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
        // --------------------------------------
        // CUSTOM UPLOAD -> Supabase Storage
        // --------------------------------------

        const ext =
          path.extname(req.file.originalname || "").toLowerCase() ||
          ".png";

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
        // --------------------------------------
        // DEFAULT GAMING AVATAR (sirf app ke apne)
        // --------------------------------------

        avatar = avatarUrl;
      } else {
        return res.status(400).json({
          success: false,
          message: "Invalid avatar",
        });
      }

      // --------------------------------------
      // SAVE IN DB
      // --------------------------------------

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

app.get("/api/admin/users", async (req, res) => {
  try {
    console.log(
      "🔍 ADMIN /api/admin/users CALLED from IP:",
      req.ip,
      "Origin:",
      req.headers.origin
    );

    const { data, error } = await supabase
      .from("registeruser")
      .select("*")
      .order("id", { ascending: false });

    if (error) {
      console.error(
        "💥 Admin users ERROR:",
        error.message
      );

      return res.status(500).json({
        users: [],
        error: error.message,
      });
    }

    console.log(
      "🟢 Admin users:",
      data?.length || 0,
      "users sent"
    );

    res.json({
      users: data || [],
    });
  } catch (err) {
    console.error("💥 Admin users CRASH:", err);

    res.status(500).json({
      users: [],
    });
  }
});

// ==========================================
// DELETE USER
// ==========================================

app.delete("/api/admin/users/:id", async (req, res) => {
  try {
    const { id } = req.params;

    console.log("🗑️ DELETE user:", id);

    const { error } = await supabase
      .from("registeruser")
      .delete()
      .eq("id", id);

    if (error) {
      console.error(
        "💥 Delete ERROR:",
        error.message
      );

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
    console.log(
  `🔥 BGMI USER SERVER (5001) running on port ${PORT}`
);

    console.log("✅ Supabase connected");
    console.log("✅ CORS active");
    console.log("✅ MY-BALANCE endpoint active");
    console.log("✅ OTP verification active");
    console.log("✅ Password reset endpoints active");
    console.log("✅ Brevo email service configured");
    console.log("✅ Admin users endpoint active");
    console.log("✅ Profile picture upload active");

    console.log(
      `✅ Test: http://localhost:${PORT}/health`
    );
  });
});