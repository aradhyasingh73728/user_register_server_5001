import express from "express";
import cors from "cors";
import { nanoid } from "nanoid";
import fs from "fs/promises";
import { createClient } from '@supabase/supabase-js';

// 🔥 Supabase connection
const supabase = createClient(
  'https://wrkrtpgfzebcmbjreyra.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indya3J0cGdmemViY21ianJleXJhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc3NzMzNDcsImV4cCI6MjA4MzM0OTM0N30.67y2ZZmtMPQugtAHj3fniFj1wgcy3hOjcG5xg3yEEj0'
);

const app = express();

/* ============================= CORS ============================= */
app.use(
  cors({
    origin: true,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// 🚀 Pre-flight fix
app.options("*", cors());
app.use(express.json());

/* ============================= DATABASE ============================= */
let users = [];
let deposits = [];
let userCounter = 8523; // BGMI-8524, BGMI-8525... se start

/* ============================= LOAD DATA ============================= */
const loadData = async () => {
  try {
    await fs.mkdir("./data", { recursive: true });

    try {
      const userData = await fs.readFile("./data/users.json", "utf8");
      users = JSON.parse(userData);

      userCounter =
        Math.max(
          8523,
          ...users.map((u) => {
            const numStr = u.profile_id.replace("BGMI-", "");
            return parseInt(numStr, 10) || 8523;
          })
        ) + 1;
      console.log("✅ Users loaded:", users.length);
    } catch {
      console.log("📝 No users file, starting from BGMI-8524...");
    }

    try {
      const depositData = await fs.readFile("./data/deposits.json", "utf8");
      deposits = JSON.parse(depositData);
      console.log("✅ Deposits loaded:", deposits.length);
    } catch {
      console.log("📝 No deposits file");
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
    if (users.find((u) => u.email === cleanEmail)) {
      return res.status(400).json({ error: "User already exists" });
    }

    const user = {
      id: nanoid(10),
      profile_id: `BGMI-${userCounter++}`,
      username: username.trim(),
      email: cleanEmail,
      balance: 0,
      createdAt: new Date().toISOString(),
      token: nanoid(32),
    };

    users.push(user);
    await saveData();

    // ✅ Supabase me bhi save
    const istTime = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    const { error } = await supabase.from('registeruser').insert([{
      profile_id: user.profile_id,
      username: user.username,
      email: user.email,
      balance: user.balance,
      register_time_ist: istTime,
      "User Password": password.trim()
    }]);

    if (error) console.error('Supabase register error:', error);

    res.json({ success: true, user });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: "Registration failed" });
  }
});

/* ============================= LOGIN ============================= */
app.post("/api/login", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Email required" });

  const user = users.find((u) => u.email === email.toLowerCase().trim());

  if (!user) return res.status(404).json({ error: "User not found" });

  user.token = nanoid(32);
  await saveData();

  res.json({ success: true, user });
});

/* ============================= DEPOSIT ============================= */
app.post("/api/deposit", async (req, res) => {
  try {
    const { email, amount, utr } = req.body;
    if (!email || !amount || !utr || Number(amount) <= 0) {
      return res.status(400).json({ error: "Invalid deposit data" });
    }

    const cleanEmail = email.toLowerCase().trim();

    let user = users.find((u) => u.email === cleanEmail);
    if (!user) {
      user = {
        id: nanoid(10),
        profile_id: `BGMI-${userCounter++}`,
        username: cleanEmail.split("@")[0],
        email: cleanEmail,
        balance: 0,
        createdAt: new Date().toISOString(),
        token: nanoid(32),
      };
      users.push(user);
      console.log("🆕 Auto registered:", user.profile_id);
    }

    const deposit = {
      id: nanoid(10),
      profile_id: user.profile_id,
      username: user.username,
      email: user.email,
      amount: Number(amount),
      utr: utr.trim(),
      status: "pending",
      createdAt: new Date().toISOString(),
    };

    deposits.push(deposit);
    await saveData();

    console.log("✅ DEPOSIT:", user.profile_id, amount);

    res.json({ success: true, deposit });
  } catch (err) {
    console.error("❌ Deposit error:", err);
    res.status(500).json({ error: "Deposit failed" });
  }
});

/* ============================= ADMIN USERS - SUPABASE SE DATA ============================= */
app.get("/api/admin/users", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('registeruser')
      .select('*')
      .order('id', { ascending: false });

    if (error) {
      console.error('Supabase fetch error:', error);
      return res.status(500).json({ users: [] });
    }

    res.json({ users: data });
  } catch (err) {
    console.error('Admin users error:', err);
    res.status(500).json({ users: [] });
  }
});

/* ============================= ADMIN DEPOSITS ============================= */
app.get("/api/admin/deposits", (req, res) => {
  res.json({ deposits: deposits.slice().reverse() });
});

app.put("/api/admin/deposit/:id/approve", async (req, res) => {
  const deposit = deposits.find((d) => d.id === req.params.id);
  if (!deposit) return res.status(404).json({ error: "Not found" });

  if (deposit.status === "approved")
    return res.status(400).json({ error: "Already approved" });

  deposit.status = "approved";
  const user = users.find((u) => u.profile_id === deposit.profile_id);
  if (user) user.balance += deposit.amount;

  await saveData();
  res.json({ success: true });
});

/* ============================= START SERVER ============================= */
const PORT = process.env.PORT || 5001;

loadData().then(() => {
  app.listen(PORT, () => {
    console.log(`🔥 BGMI Server running on ${PORT}`);
  });
});
