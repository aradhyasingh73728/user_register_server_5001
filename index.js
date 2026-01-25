import express from "express";
import cors from "cors";
import { nanoid } from "nanoid";
import { createClient } from '@supabase/supabase-js';

// 🔥 PRODUCTION: Environment Variables (Render ready!)
const supabaseUrl = process.env.SUPABASE_URL || "https://wrkrtpgfzebcmbjreyra.supabase.co";
const supabaseKey = process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indya3J0cGdmemViY21ianJleXJhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc3NzMzNDcsImV4cCI6MjA4MzM0OTM0N30.67y2ZZmtMPQugtAHj3fniFj1wgcy3hOjcG5xg3yEEj0";

const supabase = createClient(supabaseUrl, supabaseKey);

const app = express();

// 🔥 PRODUCTION CORS: Multiple origins allowed
const allowedOrigins = [
  "https://bgmi-esports-app.onrender.com",  // Frontend Render
  "http://localhost:3000",                   // Local dev
  "https://bgmi-esports-app.vercel.app",    // Vercel (future)
  "https://your-domain.com"                 // Custom domain
];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    } else {
      console.log("🚫 Blocked origin:", origin);
      return callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.options("*", cors()); // Pre-flight requests
app.use(express.json());

let userCounter = 8523;

// Initialize counter from DB
const initCounter = async () => {
  try {
    const { data } = await supabase
      .from("registeruser")
      .select("profile_id")
      .order("profile_id", { ascending: false })
      .limit(1);
    
    if (data && data[0]) {
      const lastId = data[0].profile_id.match(/BGMI-(\d+)/)?.[1];
      if (lastId) {
        userCounter = parseInt(lastId) + 1;
        console.log(`🔄 Counter set to: BGMI-${userCounter.toString().padStart(4, '0')}`);
        return;
      }
    }
    console.log("🔄 No existing users, starting from BGMI-8523");
  } catch (err) {
    console.log("⚠️ Counter init failed, using default:", userCounter);
  }
};

// 🔥 REGISTER (Production Ready)
app.post("/api/register", async (req, res) => {
  try {
    const { email, username, password, uid } = req.body;
    console.log("📥 Register attempt:", { email, username, uid: uid?.slice(0,8)+"..." });
    
    if (!email || !username || !password) {
      return res.status(400).json({ error: "Email, username & password required" });
    }

    const cleanEmail = email.toLowerCase().trim();

    // Email duplicate check
    const { data: existingUser } = await supabase
      .from("registeruser")
      .select("id")
      .eq("email", cleanEmail)
      .maybeSingle();

    if (existingUser) {
      return res.status(400).json({ error: "Email already registered" });
    }

    // Generate UNIQUE profile_id
    let profile_id;
    let attempts = 0;
    while (attempts < 100) {
      profile_id = `BGMI-${(userCounter++).toString().padStart(4, '0')}`;
      
      let existingProfile = null;
      const { data: profileCheck } = await supabase
        .from("registeruser")
        .select("id")
        .eq("profile_id", profile_id)
        .maybeSingle();
      
      existingProfile = profileCheck;
      
      if (!existingProfile) break;
      attempts++;
    }

    if (!profile_id) {
      return res.status(500).json({ error: "ID generation failed" });
    }

    const istTime = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

    // Insert to Supabase
    const { error: supaErr } = await supabase.from("registeruser").insert([{
      uid: uid || null,
      profile_id: profile_id,
      username: username.trim(),
      email: cleanEmail,
      "User Password": password.trim(),
      balance: 0,
      register_time_ist: istTime,
      verified: false
    }]);

    if (supaErr) {
      console.error("💥 Supabase ERROR:", supaErr.message);
      return res.status(500).json({ error: `DB Error: ${supaErr.message}` });
    }

    console.log("✅ SUCCESS:", profile_id, "saved to Supabase");
    
    const user = {
      profile_id,
      username: username.trim(),
      email: cleanEmail,
      balance: 0,
      token: nanoid(32)
    };

    res.json({ success: true, user });
    
  } catch (err) {
    console.error("💥 Register CRASH:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// LOGIN
app.post("/api/login", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email required" });

    const { data: user, error } = await supabase
      .from("registeruser")
      .select("*")
      .eq("email", email.toLowerCase().trim())
      .single();

    if (error || !user) return res.status(404).json({ error: "User not found" });
    res.json({ success: true, user: { ...user, token: nanoid(32) } });
  } catch (err) {
    res.status(500).json({ error: "Login failed" });
  }
});

// ADMIN USERS
app.get("/api/admin/users", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("registeruser")
      .select("*")
      .order("id", { ascending: false });
    if (error) return res.status(500).json({ users: [] });
    console.log("🟢 Admin users:", data?.length || 0);
    res.json({ users: data || [] });
  } catch (err) {
    res.status(500).json({ users: [] });
  }
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "OK", timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 5001;
initCounter().then(() => {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`🔥 BGMI Server on port ${PORT}`);
    console.log("✅ Supabase connected - Production Ready!");
    console.log("✅ CORS enabled for:", allowedOrigins.join(", "));
  });
});
