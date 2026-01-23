import express from "express";
import cors from "cors";
import { nanoid } from "nanoid";

const app = express();
app.use(cors());
app.use(express.json());

/* ============================= DATABASE (IN-MEMORY) ============================= */
let users = [];
let deposits = [];
let userCounter = 10000;  // Starting number for BGMI-XXXXX

/* ============================= REGISTER - BGMI ID FORMAT! ============================= */
app.post("/api/register", (req, res) => {
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

  // 🔥 BGMI-STYLE ID: BGMI-10246
  const bgmiIdNumber = userCounter++;
  const newUser = {
    id: nanoid(10),
    profile_id: `BGMI-${bgmiIdNumber}`,  // BGMI-10246 format!
    username: cleanUsername,
    email: cleanEmail,
    balance: 0,
    createdAt: new Date().toISOString(),
    token: nanoid(32),
  };

  users.push(newUser);
  console.log("✅ REGISTER:", newUser.profile_id, newUser.username, newUser.email);

  res.json({
    success: true,
    token: newUser.token,
    user: {
      profile_id: newUser.profile_id,  // BGMI-10246
      username: newUser.username,
      email: newUser.email,
      balance: newUser.balance,
    },
  });
});

/* ============================= LOGIN ============================= */
app.post("/api/login", (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: "Email required" });
  }

  const user = users.find(u => u.email === email.toLowerCase().trim());

  if (!user) {
    return res.status(404).json({ error: "User not registered. Register first." });
  }

  user.token = nanoid(32);
  console.log("🔐 LOGIN:", user.profile_id, user.username, user.email);

  res.json({
    success: true,
    token: user.token,
    user: {
      profile_id: user.profile_id,  // BGMI-10246
      username: user.username,
      email: user.email,
      balance: user.balance,
    },
  });
});

/* ============================= DEPOSIT ============================= */
app.post("/api/deposit", (req, res) => {
  const { email, amount, utr } = req.body;

  console.log("💰 DEPOSIT REQUEST:", { email, amount, utr });

  if (!email || !amount || !utr || Number(amount) <= 0) {
    return res.status(400).json({ error: "Invalid deposit data" });
  }

  const cleanEmail = email.toLowerCase().trim();
  const user = users.find(u => u.email === cleanEmail);

  if (!user) {
    console.log("❌ USER NOT FOUND:", cleanEmail);
    console.log("📋 USERS:", users.map(u => u.profile_id));
    return res.status(404).json({ error: "User not found. Register first." });
  }

  const deposit = {
    id: nanoid(10),
    profile_id: user.profile_id,  // BGMI-10246 format!
    username: user.username,
    email: user.email,
    amount: Number(amount),
    utr: utr.trim(),
    status: "pending",
    createdAt: new Date().toISOString(),
  };

  deposits.push(deposit);
  console.log("✅ DEPOSIT:", deposit.profile_id, `₹${amount}`);

  res.json({
    success: true,
    message: "Deposit created - pending approval",
    deposit,
  });
});

/* ============================= ADMIN ENDPOINTS ============================= */
app.get("/api/admin/deposits", (req, res) => {
  console.log("👁️ ADMIN: Loading deposits...");
  res.json({ deposits: deposits.slice().reverse() });
});

app.put("/api/admin/deposit/:id/approve", (req, res) => {
  const deposit = deposits.find(d => d.id === req.params.id);
  if (!deposit) return res.status(404).json({ error: "Deposit not found" });

  if (deposit.status === "approved") {
    return res.status(400).json({ error: "Already approved" });
  }

  deposit.status = "approved";
  const user = users.find(u => u.profile_id === deposit.profile_id);
  if (user) {
    user.balance += deposit.amount;
    console.log(`💰 APPROVED: ${user.profile_id} +₹${deposit.amount} (New balance: ₹${user.balance})`);
  }

  res.json({ success: true, balance: user ? user.balance : 0 });
});

app.put("/api/admin/deposit/:id/reject", (req, res) => {
  const deposit = deposits.find(d => d.id === req.params.id);
  if (!deposit) return res.status(404).json({ error: "Deposit not found" });

  deposit.status = "rejected";
  console.log(`❌ REJECTED: ${deposit.profile_id} ₹${deposit.amount}`);
  res.json({ success: true });
});

// 🔥 ADMIN USERS - FULL DATA WITH ID FIELD
app.get("/api/admin/users", (req, res) => {
  console.log("👥 ADMIN: Loading all users...");
  console.log("📊 Total users:", users.length);
  
  res.json({
    users: users.map(u => ({
      id: u.id,                           // nanoid(10) - DELETE के लिए
      profile_id: u.profile_id,           // BGMI-10001
      username: u.username,               // Akash
      email: u.email,                     // wegab86429@lawicon.com
      balance: u.balance,                 // 0 या approved deposits
      createdAt: u.createdAt              // ISO timestamp
    }))
  });
});

// 🔥 DELETE USER ENDPOINT
app.delete("/api/admin/users/:id", (req, res) => {
  const userId = req.params.id;
  const userIndex = users.findIndex(u => u.id === userId);
  
  if (userIndex === -1) {
    console.log("❌ ADMIN: User not found:", userId);
    return res.status(404).json({ error: "User not found" });
  }
  
  const deletedUser = users.splice(userIndex, 1)[0];
  console.log("🗑️ DELETED USER:", deletedUser.profile_id, deletedUser.username, deletedUser.email);
  
  res.json({ 
    success: true, 
    message: `User ${deletedUser.profile_id} deleted successfully` 
  });
});

/* ============================= SERVER START ============================= */
const PORT = 5001;
app.listen(PORT, () => {
  console.log(`🔥 BGMI Server: http://localhost:${PORT}`);
  console.log("👥 Users:", users.length);
  console.log("💰 Deposits:", deposits.length);
  console.log("🟢 Admin endpoints ready: /api/admin/users, /api/admin/deposits");
});
