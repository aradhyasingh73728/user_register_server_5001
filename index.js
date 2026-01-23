import express from "express";
import cors from "cors";
import { nanoid } from "nanoid";
import Database from "better-sqlite3"; // npm install better-sqlite3

const app = express();

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

// 🔥 RENDER FRIENDLY - SQLite Database
let db;
let users = [];
let deposits = [];
let userCounter = 10000;

const initDB = () => {
  const dbPath = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).pathname.slice(1) : './db.sqlite';
  
  db = new Database(dbPath);
  
  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      profile_id TEXT UNIQUE,
      username TEXT,
      email TEXT UNIQUE,
      balance REAL DEFAULT 0,
      createdAt TEXT,
      token TEXT
    );
    
    CREATE TABLE IF NOT EXISTS deposits (
      id TEXT PRIMARY KEY,
      profile_id TEXT,
      username TEXT,
      email TEXT,
      amount REAL,
      utr TEXT,
      status TEXT,
      createdAt TEXT
    );
  `);

  // Load existing data
  const loadUsers = db.prepare("SELECT * FROM users ORDER BY profile_id").all();
  users = loadUsers;
  if (users.length > 0) {
    userCounter = Math.max(10000, ...users.map(u => parseInt(u.profile_id.replace('BGMI-', ''))) + 1);
  }
  
  deposits = db.prepare("SELECT * FROM deposits ORDER BY createdAt DESC").all();
  
  console.log("✅ SQLite loaded:", users.length, "users,", deposits.length, "deposits");
};

// 🔥 Database wrappers
const saveUser = (user) => {
  db.prepare(`
    INSERT OR REPLACE INTO users 
    (id, profile_id, username, email, balance, createdAt, token)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(user.id, user.profile_id, user.username, user.email, user.balance, user.createdAt, user.token);
};

const saveDeposit = (deposit) => {
  db.prepare(`
    INSERT INTO deposits 
    (id, profile_id, username, email, amount, utr, status, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(deposit.id, deposit.profile_id, deposit.username, deposit.email, deposit.amount, deposit.utr, deposit.status, deposit.createdAt);
};

const updateDepositStatus = (id, status) => {
  db.prepare("UPDATE deposits SET status = ? WHERE id = ?").run(status, id);
};

const updateUserBalance = (profile_id, amount) => {
  db.prepare("UPDATE users SET balance = balance + ? WHERE profile_id = ?").run(amount, profile_id);
};

const deleteUser = (id) => {
  db.prepare("DELETE FROM users WHERE id = ?").run(id);
};

// 🔥 Load on startup
initDB();

// 🔥 Same endpoints, just DB calls badlo
app.post("/api/register", async (req, res) => {
  try {
    const { email, username } = req.body;
    if (!email || !username) return res.status(400).json({ error: "Email & Username required" });

    const cleanEmail = email.toLowerCase().trim();
    
    const existing = db.prepare("SELECT * FROM users WHERE email = ?").get(cleanEmail);
    if (existing) return res.status(400).json({ error: "User already exists" });

    const bgmiIdNumber = userCounter++;
    const newUser = {
      id: nanoid(10),
      profile_id: `BGMI-${bgmiIdNumber}`,
      username: username.trim(),
      email: cleanEmail,
      balance: 0,
      createdAt: new Date().toISOString(),
      token: nanoid(32),
    };

    saveUser(newUser);
    users.push(newUser);
    
    console.log("✅ REGISTER:", newUser.profile_id);
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

// Login endpoint
app.post("/api/login", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Email required" });

  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase().trim());
  if (!user) return res.status(404).json({ error: "User not registered" });

  const newToken = nanoid(32);
  db.prepare("UPDATE users SET token = ? WHERE id = ?").run(newToken, user.id);
  
  console.log("🔐 LOGIN:", user.profile_id);
  res.json({
    success: true,
    token: newToken,
    user: {
      profile_id: user.profile_id,
      username: user.username,
      email: user.email,
      balance: user.balance,
    },
  });
});

// Deposit endpoint
app.post("/api/deposit", async (req, res) => {
  try {
    const { email, amount, utr } = req.body;
    if (!email || !amount || !utr || Number(amount) <= 0) {
      return res.status(400).json({ error: "Invalid deposit data" });
    }

    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase().trim());
    if (!user) return res.status(404).json({ error: "User not found" });

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

    saveDeposit(deposit);
    deposits.unshift(deposit); // Add to front for latest first
    
    console.log("✅ DEPOSIT:", deposit.profile_id, `₹${amount}`);
    res.json({ success: true, message: "Deposit created - pending approval", deposit });
  } catch (err) {
    res.status(500).json({ error: "Deposit failed" });
  }
});

// Admin endpoints (same logic, DB calls)
app.get("/api/admin/deposits", (req, res) => {
  const latestDeposits = db.prepare("SELECT * FROM deposits ORDER BY createdAt DESC").all();
  res.json({ deposits: latestDeposits });
});

app.put("/api/admin/deposit/:id/approve", async (req, res) => {
  const deposit = db.prepare("SELECT * FROM deposits WHERE id = ?").get(req.params.id);
  if (!deposit) return res.status(404).json({ error: "Deposit not found" });

  if (deposit.status === "approved") return res.status(400).json({ error: "Already approved" });

  updateDepositStatus(req.params.id, "approved");
  updateUserBalance(deposit.profile_id, deposit.amount);
  
  console.log(`💰 APPROVED: ${deposit.profile_id} +₹${deposit.amount}`);
  res.json({ success: true });
});

app.get("/api/admin/users", (req, res) => {
  const allUsers = db.prepare(`
    SELECT id, profile_id, username, email, balance, createdAt 
    FROM users 
    ORDER BY createdAt DESC
  `).all();
  res.json({ users: allUsers });
});

app.delete("/api/admin/users/:id", async (req, res) => {
  deleteUser(req.params.id);
  res.json({ success: true });
});

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
  console.log(`🔥 BGMI Server: PORT ${PORT}`);
  console.log("🟢 SQLite persistent storage ready!");
});
