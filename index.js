import express from "express";
import cors from "cors";
import { nanoid } from "nanoid";
import fs from "fs/promises";  // 🔥 FILE STORAGE

const app = express();

// 🔥 FIXED CORS - Production ready
app.use(cors({
  origin: [
    "http://localhost:3000",
    "https://bgmi-esports.netlify.app",
    "https://bgmi-esports.vercel.app",
    "https://*.netlify.app",
    "https://*.vercel.app"
  ],
  credentials: true
}));
app.use(express.json());

/* ============================= PERSISTENT DATABASE ============================= */
let users = [];
let deposits = [];
let userCounter = 10000;

// 🔥 LOAD DATA ON START
const loadData = async () => {
  try {
    await fs.mkdir("./data", { recursive: true });
    
    try {
      const userData = await fs.readFile("./data/users.json", "utf8");
      users = JSON.parse(userData);
      userCounter = Math.max(10000, ...users.map(u => parseInt(u.profile_id.replace('BGMI-', ''))) + 1);
      console.log("✅ Loaded", users.length, "users");
    } catch {
      console.log("📝 No users file - starting fresh");
    }
    
    try {
      const depositData = await fs.readFile("./data/deposits.json", "utf8");
      deposits = JSON.parse(depositData);
      console.log("✅ Loaded", deposits.length, "deposits");
    } catch {
      console.log("📝 No deposits file - starting fresh");
    }
  } catch (err) {
    console.error("❌ Data load error:", err.message);
  }
};

// 🔥 SAVE DATA AFTER EVERY CHANGE
const saveData = async () => {
  try {
    await fs.mkdir("./data", { recursive: true });
    await fs.writeFile("./data/users.json", JSON.stringify(users, null, 2));
    await fs.writeFile("./data/deposits.json", JSON.stringify(deposits, null, 2));
  } catch (err) {
    console.error("💾 Save error:", err.message);
  }
};

/* ============================= REGISTER ============================= */
app.post("/api/register", async (req, res) => {
  try {
    const { email, username } = req.body;

    if (!email || !username) {
      return res.status(400).json({ error: "Email & Username required" });
    }

    const cleanEmail = email.toLowerCase().trim();
    const cleanUsername = username.trim();

    const exists = users.find(u => u.email === cleanEmail);
    if (exists) {
      return res.status(400).json({ error: "User already exists" });
    }

    const bgmiIdNumber = userCounter++;
    const newUser = {
      id: nanoid(10),
      profile_id: `BGMI-${bgmiIdNumber}`,
      username: cleanUsername,
      email: cleanEmail,
      balance: 0,
      createdAt: new Date().toISOString(),
      token: nanoid(32),
    };

    users.push(newUser);
    await saveData();  // 🔥 SAVE IMMEDIATELY
    
    console.log("✅ REGISTER:", newUser.profile_id, newUser.username);
    
    res.json({
      success: true,
      token: newUser.token,
      user: {
        profile_id: newUser.profile_id,
        username: newUser.username,
        email: newUser.email,
        balance: newUser.balance,
      },
    });
  } catch (err) {
    console.error("❌ Register error:", err);
    res.status(500).json({ error: "Registration failed" });
  }
});

/* ============================= LOGIN ============================= */
app.post("/api/login", async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: "Email required" });
  }

  const user = users.find(u => u.email === email.toLowerCase().trim());

  if (!user) {
    return res.status(404).json({ error: "User not registered. Register first." });
  }

  user.token = nanoid(32);
  await saveData();
  
  console.log("🔐 LOGIN:", user.profile_id);
  
  res.json({
    success: true,
    token: user.token,
    user: {
      profile_id: user.profile_id,
      username: user.username,
      email: user.email,
      balance: user.balance,
    },
  });
});

/* ============================= DEPOSIT ============================= */
app.post("/api/deposit", async (req, res) => {
  try {
    const { email, amount, utr } = req.body;

    if (!email || !amount || !utr || Number(amount) <= 0) {
      return res.status(400).json({ error: "Invalid deposit data" });
    }

    const cleanEmail = email.toLowerCase().trim();
    const user = users.find(u => u.email === cleanEmail);

    if (!user) {
      return res.status(404).json({ error: "User not found. Register first." });
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
    await saveData();  // 🔥 SAVE
    
    console.log("✅ DEPOSIT:", deposit.profile_id, `₹${amount}`);
    
    res.json({
      success: true,
      message: "Deposit created - pending approval",
      deposit,
    });
  } catch (err) {
    res.status(500).json({ error: "Deposit failed" });
  }
});

/* ============================= ADMIN ENDPOINTS ============================= */
app.get("/api/admin/deposits", (req, res) => {
  console.log("👁️ ADMIN deposits:", deposits.length);
  res.json({ deposits: deposits.slice().reverse() });
});

app.put("/api/admin/deposit/:id/approve", async (req, res) => {
  const deposit = deposits.find(d => d.id === req.params.id);
  if (!deposit) return res.status(404).json({ error: "Deposit not found" });

  if (deposit.status === "approved") {
    return res.status(400).json({ error: "Already approved" });
  }

  deposit.status = "approved";
  const user = users.find(u => u.profile_id === deposit.profile_id);
  if (user) {
    user.balance += deposit.amount;
  }
  
  await saveData();  // 🔥 SAVE
  
  console.log(`💰 APPROVED: ${deposit.profile_id} +₹${deposit.amount}`);
  res.json({ success: true, balance: user ? user.balance : 0 });
});

app.put("/api/admin/deposit/:id/reject", async (req, res) => {
  const deposit = deposits.find(d => d.id === req.params.id);
  if (!deposit) return res.status(404).json({ error: "Deposit not found" });

  deposit.status = "rejected";
  await saveData();
  
  console.log(`❌ REJECTED: ${deposit.profile_id}`);
  res.json({ success: true });
});

app.get("/api/admin/users", (req, res) => {
  console.log("👥 ADMIN users:", users.length);
  res.json({
    users: users.map(u => ({
      id: u.id,
      profile_id: u.profile_id,
      username: u.username,
      email: u.email,
      balance: u.balance,
      createdAt: u.createdAt
    }))
  });
});

app.delete("/api/admin/users/:id", async (req, res) => {
  const userId = req.params.id;
  const userIndex = users.findIndex(u => u.id === userId);
  
  if (userIndex === -1) {
    return res.status(404).json({ error: "User not found" });
  }
  
  const deletedUser = users.splice(userIndex, 1)[0];
  await saveData();
  
  console.log("🗑️ DELETED:", deletedUser.profile_id);
  res.json({ success: true, message: `User ${deletedUser.profile_id} deleted` });
});

/* ============================= SERVER START ============================= */
const PORT = process.env.PORT || 5001;

loadData().then(() => {
  app.listen(PORT, () => {
    console.log(`🔥 BGMI Server: PORT ${PORT}`);
    console.log("👥 Users:", users.length);
    console.log("💰 Deposits:", deposits.length);
    console.log("🟢 Admin endpoints ready!");
    console.log("💾 Persistent storage: ./data/");
  });
});
