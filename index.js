import express from "express";
import cors from "cors";
import { nanoid } from "nanoid";
import fs from "fs/promises";
import { createClient } from '@supabase/supabase-js';

// 🔥 Supabase client
const supabase = createClient(
  "https://wrkrtpgfzebcmbjreyra.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indya3J0cGdmemViY21ianJleXJhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc3NzMzNDcsImV4cCI6MjA4MzM0OTM0N30.67y2ZZmtMPQugtAHj3fniFj1wgcy3hOjcG5xg3yEEj0"
);

const app = express();

/* ============================= CORS ============================= */
app.use(cors({
  origin: true,
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.options("*", cors());
app.use(express.json());

/* ============================= DATABASE ============================= */
let users = [];
let deposits = [];
let userCounter = 8523;

/* ============================= LOAD DATA ============================= */
const loadData = async () => {
  try {
    await fs.mkdir("./data", { recursive: true });

    try {
      const userRaw = await fs.readFile("./data/users.json", "utf8");
      users = JSON.parse(userRaw);
      userCounter = Math.max(8523, ...users.map(u => {
        const numStr = u.profile_id.replace("BGMI-", "");
        return parseInt(numStr, 10) || 8523;
      })) + 1;
      console.log("✅ Users loaded:", users.length);
    } catch (err) {
      console.log("📝 No users.json, starting from BGMI-8524");
    }

    try {
      const depositRaw = await fs.readFile("./data/deposits.json", "utf8");
      deposits = JSON.parse(depositRaw);
      console.log("✅ Deposits loaded:", deposits.length);
    } catch (err) {
      console.log("📝 No deposits.json");
    }
  } catch (err) {
    console.error("❌ Load error:", err.message);
  }
};

/* ============================= SAVE DATA ============================= */
const saveData = async () => {
  await fs.mkdir("./data", { recursive: true });
  await fs.writeFile("./data/users.json", JSON.stringify(users, null, 2));
  await fs.writeFile("./data/deposits.json", JSON.stringify(deposits, null, 2));
};

/* ============================= REGISTER ============================= */
app.post("/api/register", async (req, res) => {
  try {
    const { email, username, password } = req.body;
    if (!email || !username || !password)
      return res.status(400).json({ error: "Email, Username & Password required" });

    const cleanEmail = email.toLowerCase().trim();
    if (users.find(u => u.email === cleanEmail))
      return res.status(400).json({ error: "User already exists" });

    const user = {
      id: nanoid(10),
      profile_id: `BGMI-${userCounter++}`,
      username: username.trim(),
      email: cleanEmail,
      balance: 0,
      createdAt: new Date().toISOString(),
      token: nanoid(32)
    };

    users.push(user);
    await saveData();

    const istTime = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
    const { error: supaErr } = await supabase.from("registeruser").insert([{
      profile_id: user.profile_id,
      username: user.username,
      email: user.email,
      balance: user.balance,
      register_time_ist: istTime,
      "User Password": password.trim()
    }]);

    if (supaErr) console.error("💥 Supabase insert error:", supaErr);

    res.json({ success: true, user });
  } catch (err) {
    console.error("💥 Register error:", err);
    res.status(500).json({ error: "Registration failed" });
  }
});

/* ============================= LOGIN ============================= */
app.post("/api/login", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Email required" });

  const user = users.find(u => u.email === email.toLowerCase().trim());
  if (!user) return res.status(404).json({ error: "User not found" });

  user.token = nanoid(32);
  await saveData();

  res.json({ success: true, user });
});

/* ============================= ADMIN USERS ============================= */
app.get("/api/admin/users", async (req, res) => {
  console.log("🟢 /api/admin/users requested");
  try {
    const { data, error } = await supabase
      .from("registeruser")
      .select("*")
      .order("id", { ascending: false });

    if (error) {
      console.error("💥 Supabase fetch error:", error);
      return res.status(500).json({ users: [] });
    }

    console.log("🟢 Data from Supabase:", data);
    res.json({ users: data });
  } catch (err) {
    console.error("💥 Admin /api/admin/users error:", err);
    res.status(500).json({ users: [] });
  }
});

/* ============================= START SERVER ============================= */
const PORT = process.env.PORT || 5001;

loadData().then(() => {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`🔥 BGMI Server running on 0.0.0.0:${PORT}`);
  });
});

console.log("🚀 Server starting with PORT:", PORT);
