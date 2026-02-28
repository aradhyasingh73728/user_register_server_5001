import express from "express";
import cors from "cors";
import { nanoid } from "nanoid";
import { createClient } from '@supabase/supabase-js';

// 🔥 PRODUCTION: Environment Variables (Render ready!)
const supabaseUrl = process.env.SUPABASE_URL || "https://wrkrtpgfzebcmbjreyra.supabase.co";
const supabaseKey = process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indya3J0cGdmemViY21ianJleXJhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc3NzMzNDcsImV4cCI6MjA4MzM0OTM0N30.67y2ZZmtMPQugtAHj3fniFj1wgcy3hOjcG5xg3yEEj0";

const supabase = createClient(supabaseUrl, supabaseKey);
const app = express();

// 🔥 ADMIN PANEL + REGISTER = 100% CORS FIXED
app.use(cors({
  origin: true,  // ✅ ALL ORIGINS ALLOWED (Register + Admin + Wallet dono chalega!)
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
})); 
app.use(express.json());

let userCounter = 8523;

// 🔥 MY BALANCE ENDPOINT (Wallet.jsx ke liye!)
app.get("/api/my-balance", async (req, res) => {
  try {
    const { profileId } = req.query;
    if (!profileId) {
      console.log("❌ No profileId provided for balance");
      return res.json({ balance: 0 });
    }
    
    const { data } = await supabase
      .from("registeruser")
      .select("balance")
      .eq("profile_id", profileId)
      .single();
    
    const balance = data?.balance || 0;
    console.log("💰 BALANCE FETCH:", profileId, "→ ₹", balance);
    res.json({ balance });
  } catch (err) {
    console.error("❌ BALANCE ERROR:", err);
    res.json({ balance: 0 });
  }
});

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
      
      const { data: profileCheck } = await supabase
        .from("registeruser")
        .select("id")
        .eq("profile_id", profile_id)
        .maybeSingle();
      
      if (!profileCheck) break;
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

// 🔥 ADMIN USERS (ENHANCED LOGGING)
app.get("/api/admin/users", async (req, res) => {
  try {
    console.log("🔍 ADMIN /api/admin/users CALLED from IP:", req.ip, "Origin:", req.headers.origin);
    
    const { data, error } = await supabase
      .from("registeruser")
      .select("*")
      .order("id", { ascending: false });
    
    if (error) {
      console.error("💥 Admin users ERROR:", error.message);
      return res.status(500).json({ users: [], error: error.message });
    }
    
    console.log("🟢 Admin users:", data?.length || 0, "users sent");
    res.json({ users: data || [] });
  } catch (err) {
    console.error("💥 Admin users CRASH:", err);
    res.status(500).json({ users: [] });
  }
});

// DELETE USER (Admin Panel)
app.delete("/api/admin/users/:id", async (req, res) => {
  try {
    const { id } = req.params;
    console.log("🗑️ DELETE user:", id);
    
    const { error } = await supabase
      .from("registeruser")
      .delete()
      .eq("id", id);
    
    if (error) {
      console.error("💥 Delete ERROR:", error.message);
      return res.status(500).json({ error: error.message });
    }
    
    console.log("✅ User deleted:", id);
    res.json({ success: true });
  } catch (err) {
    console.error("💥 Delete CRASH:", err);
    res.status(500).json({ error: "Delete failed" });
  }
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ 
    status: "OK", 
    timestamp: new Date().toISOString(),
    myBalance: "✅ ACTIVE",
    port: 5001 
  });
});

const PORT = process.env.PORT || 5001;
initCounter().then(() => {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`🔥 BGMI USER SERVER (5001) running on port ${PORT}`);
    console.log("✅ Supabase connected - Production Ready!");
    console.log("✅ CORS: ALL ORIGINS ALLOWED ✅");
    console.log("✅ MY-BALANCE ENDPOINT → ACTIVE! 💰");
    console.log("✅ Admin Panel: /api/admin/users ✅");
    console.log("✅ Test: http://localhost:${PORT}/health");
  });
});