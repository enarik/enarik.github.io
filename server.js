require("dotenv").config();
const express = require("express");
const session = require("express-session");
const FileStore = require("session-file-store")(session);
const { DatabaseSync } = require("node:sqlite");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

// ── Database setup ──────────────────────────────────────────────────────────

const DB_PATH = path.join(__dirname, "db", "booth.sqlite");
const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS parties (
    id          TEXT PRIMARY KEY,
    firstName   TEXT NOT NULL,
    lastInitial TEXT NOT NULL,
    partySize   INTEGER NOT NULL,
    contactMethod TEXT NOT NULL,
    contactValue  TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'waiting',
    position    INTEGER NOT NULL,
    estimatedWait INTEGER,
    notifyCount INTEGER NOT NULL DEFAULT 0,
    entryTime   TEXT,
    exitTime    TEXT,
    boothDate   TEXT NOT NULL,
    createdAt   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS booth_tables (
    id       TEXT PRIMARY KEY,
    name     TEXT NOT NULL,
    position INTEGER NOT NULL,
    active   INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS seats (
    id         TEXT PRIMARY KEY,
    tableId    TEXT NOT NULL REFERENCES booth_tables(id) ON DELETE CASCADE,
    side       TEXT NOT NULL,
    seatNumber INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS seat_assignments (
    id         TEXT PRIMARY KEY,
    seatId     TEXT NOT NULL UNIQUE REFERENCES seats(id) ON DELETE CASCADE,
    partyId    TEXT NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
    personName TEXT NOT NULL,
    assignedAt TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// ── Helpers ─────────────────────────────────────────────────────────────────

function cuid() {
  return "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// ── Middleware ───────────────────────────────────────────────────────────────

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    store: new FileStore({ path: path.join(__dirname, "db", "sessions"), ttl: 43200, reapInterval: 3600 }),
    secret: process.env.SESSION_SECRET || "dev-secret",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 12 * 60 * 60 * 1000 }, // 12 hours
  })
);

function requireAuth(req, res, next) {
  if (!req.session.role) return res.status(401).json({ error: "Unauthorized" });
  next();
}

function requireAdmin(req, res, next) {
  if (req.session.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  next();
}

// ── Auth routes ──────────────────────────────────────────────────────────────

app.post("/api/auth/login", (req, res) => {
  const { role, password } = req.body;
  if (role === "admin" && password === process.env.ADMIN_PASSWORD) {
    req.session.role = "admin";
    return res.json({ role: "admin" });
  }
  if (role === "greeter" && password === process.env.GREETER_PASSWORD) {
    req.session.role = "greeter";
    return res.json({ role: "greeter" });
  }
  res.status(401).json({ error: "Incorrect password" });
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

app.get("/api/auth/me", (req, res) => {
  if (!req.session.role) return res.status(401).json({ error: "Not logged in" });
  res.json({ role: req.session.role });
});

// ── Parties routes ────────────────────────────────────────────────────────────

app.get("/api/parties", (req, res) => {
  const date = req.query.date || today();
  const parties = db
    .prepare(
      `SELECT p.*,
        json_group_array(
          CASE WHEN sa.id IS NOT NULL THEN json_object(
            'id', sa.id, 'seatId', sa.seatId, 'personName', sa.personName,
            'seat', json_object('id', s.id, 'side', s.side, 'seatNumber', s.seatNumber,
              'table', json_object('id', bt.id, 'name', bt.name))
          ) END
        ) as seatAssignmentsRaw
      FROM parties p
      LEFT JOIN seat_assignments sa ON sa.partyId = p.id
      LEFT JOIN seats s ON s.id = sa.seatId
      LEFT JOIN booth_tables bt ON bt.id = s.tableId
      WHERE p.boothDate = ?
      GROUP BY p.id
      ORDER BY p.position ASC`
    )
    .all(date)
    .map((p) => {
      const raw = JSON.parse(p.seatAssignmentsRaw || "[]");
      return { ...p, seatAssignments: raw.filter(Boolean) };
    });
  res.json(parties);
});

app.post("/api/parties", (req, res) => {
  const { firstName, lastInitial, partySize, contactMethod, contactValue } = req.body;
  if (!firstName || !lastInitial || !partySize || !contactMethod || !contactValue) {
    return res.status(400).json({ error: "Missing required fields" });
  }
  const date = today();
  const last = db.prepare("SELECT MAX(position) as pos FROM parties WHERE boothDate = ?").get(date);
  const position = (last?.pos || 0) + 1;
  const id = cuid();
  db.prepare(
    `INSERT INTO parties (id, firstName, lastInitial, partySize, contactMethod, contactValue, position, boothDate)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, firstName, lastInitial.toUpperCase(), Number(partySize), contactMethod, contactValue, position, date);
  res.status(201).json(db.prepare("SELECT * FROM parties WHERE id = ?").get(id));
});

app.patch("/api/parties/:id", requireAuth, (req, res) => {
  const party = db.prepare("SELECT * FROM parties WHERE id = ?").get(req.params.id);
  if (!party) return res.status(404).json({ error: "Not found" });

  const allowed = ["status", "estimatedWait", "position", "entryTime", "exitTime",
    "firstName", "lastInitial", "partySize", "contactMethod", "contactValue"];
  const updates = {};
  for (const key of allowed) {
    if (key in req.body) updates[key] = req.body[key];
  }

  if (req.body.status === "in-booth" && !party.entryTime && !req.body.entryTime) {
    updates.entryTime = new Date().toISOString();
  }
  if (req.body.status === "completed" && !party.exitTime && !req.body.exitTime) {
    updates.exitTime = new Date().toISOString();
    // Clear seat assignments when party exits
    db.prepare("DELETE FROM seat_assignments WHERE partyId = ?").run(req.params.id);
  }

  if (Object.keys(updates).length === 0) return res.json(party);

  const sets = Object.keys(updates).map((k) => `${k} = ?`).join(", ");
  db.prepare(`UPDATE parties SET ${sets} WHERE id = ?`).run(...Object.values(updates), req.params.id);
  res.json(db.prepare("SELECT * FROM parties WHERE id = ?").get(req.params.id));
});

app.delete("/api/parties/:id", requireAdmin, (req, res) => {
  db.prepare("DELETE FROM parties WHERE id = ?").run(req.params.id);
  res.json({ success: true });
});

app.post("/api/parties/reorder", requireAuth, (req, res) => {
  const { orderedIds } = req.body;
  const update = db.prepare("UPDATE parties SET position = ? WHERE id = ?");
  db.exec("BEGIN");
  try {
    orderedIds.forEach((id, i) => update.run(i + 1, id));
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  res.json({ success: true });
});

// ── Notify route ──────────────────────────────────────────────────────────────

app.post("/api/notify", requireAuth, async (req, res) => {
  const { partyId, message } = req.body;
  const party = db.prepare("SELECT * FROM parties WHERE id = ?").get(partyId);
  if (!party) return res.status(404).json({ error: "Party not found" });
  if (party.notifyCount >= 2) return res.status(400).json({ error: "Notification limit reached" });

  const body = message || `Hi ${party.firstName}! Your party is next — please make your way to the booth now. See you soon!`;
  const testMode = process.env.NOTIFY_TEST_MODE === "true";

  try {
    if (testMode) {
      console.log(`[NOTIFY TEST] ${party.contactMethod.toUpperCase()} → ${party.contactValue}: ${body}`);
    } else if (party.contactMethod === "sms") {
      const twilio = require("twilio");
      const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      await client.messages.create({ body, from: process.env.TWILIO_PHONE_NUMBER, to: party.contactValue });
    } else if (party.contactMethod === "email") {
      const sgMail = require("@sendgrid/mail");
      sgMail.setApiKey(process.env.SENDGRID_API_KEY);
      await sgMail.send({
        to: party.contactValue,
        from: { email: process.env.SENDGRID_FROM_EMAIL, name: process.env.SENDGRID_FROM_NAME || "Convention Booth" },
        subject: "You're up next at the booth!",
        text: body,
        html: `<p>${body}</p>`,
      });
    }

    const newCount = party.notifyCount + 1;
    const newStatus = party.status === "waiting" ? "notified" : party.status;
    db.prepare("UPDATE parties SET notifyCount = ?, status = ? WHERE id = ?").run(newCount, newStatus, partyId);
    res.json(db.prepare("SELECT * FROM parties WHERE id = ?").get(partyId));
  } catch (err) {
    console.error("Notification error:", err);
    res.status(500).json({ error: "Failed to send notification" });
  }
});

// ── Tables routes ─────────────────────────────────────────────────────────────

function getTablesWithSeats() {
  const tables = db.prepare("SELECT * FROM booth_tables WHERE active = 1 ORDER BY position ASC").all();
  return tables.map((t) => {
    const seats = db.prepare("SELECT * FROM seats WHERE tableId = ? ORDER BY side ASC, seatNumber ASC").all(t.id);
    return {
      ...t,
      seats: seats.map((s) => {
        const assignment = db.prepare(`
          SELECT sa.*, p.firstName, p.lastInitial, p.partySize
          FROM seat_assignments sa
          JOIN parties p ON p.id = sa.partyId
          WHERE sa.seatId = ?
        `).get(s.id);
        return { ...s, assignment: assignment || null };
      }),
    };
  });
}

app.get("/api/tables", (req, res) => {
  res.json(getTablesWithSeats());
});

app.post("/api/tables", requireAdmin, (req, res) => {
  const last = db.prepare("SELECT MAX(position) as pos FROM booth_tables").get();
  const position = (last?.pos || 0) + 1;
  const id = cuid();
  const name = req.body.name || `Table ${position}`;
  db.prepare("INSERT INTO booth_tables (id, name, position) VALUES (?, ?, ?)").run(id, name, position);
  const seatInsert = db.prepare("INSERT INTO seats (id, tableId, side, seatNumber) VALUES (?, ?, ?, ?)");
  [["left", 1], ["left", 2], ["right", 1], ["right", 2]].forEach(([side, num]) => {
    seatInsert.run(cuid(), id, side, num);
  });
  res.status(201).json(getTablesWithSeats().find((t) => t.id === id));
});

app.patch("/api/tables/:id", requireAdmin, (req, res) => {
  const { name } = req.body;
  if (name) db.prepare("UPDATE booth_tables SET name = ? WHERE id = ?").run(name, req.params.id);
  res.json(db.prepare("SELECT * FROM booth_tables WHERE id = ?").get(req.params.id));
});

app.delete("/api/tables/:id", requireAdmin, (req, res) => {
  db.prepare("UPDATE booth_tables SET active = 0 WHERE id = ?").run(req.params.id);
  res.json({ success: true });
});

// ── Seats routes ──────────────────────────────────────────────────────────────

app.post("/api/seats", requireAuth, (req, res) => {
  const { seatId, partyId, personName } = req.body;
  db.prepare("DELETE FROM seat_assignments WHERE seatId = ?").run(seatId);
  if (partyId && personName) {
    db.prepare("INSERT INTO seat_assignments (id, seatId, partyId, personName) VALUES (?, ?, ?, ?)")
      .run(cuid(), seatId, partyId, personName);
  }
  res.json({ success: true });
});

// ── Stats route ───────────────────────────────────────────────────────────────

app.get("/api/stats", requireAuth, (req, res) => {
  const date = req.query.date || today();
  const completed = db.prepare("SELECT * FROM parties WHERE boothDate = ? AND status = 'completed'").all(date);
  const noShows = db.prepare("SELECT COUNT(*) as n FROM parties WHERE boothDate = ? AND status = 'no-show'").get(date).n;

  const totalIndividuals = completed.reduce((s, p) => s + p.partySize, 0);
  const avgPartySize = completed.length ? Math.round((totalIndividuals / completed.length) * 10) / 10 : 0;

  const waitMinutes = completed
    .filter((p) => p.entryTime && p.createdAt)
    .map((p) => (new Date(p.entryTime) - new Date(p.createdAt)) / 60000);
  const avgWaitMinutes = waitMinutes.length ? Math.round(waitMinutes.reduce((a, b) => a + b, 0) / waitMinutes.length) : 0;

  const peakHours = {};
  for (const p of completed) {
    if (p.entryTime) {
      const h = new Date(p.entryTime).getHours();
      peakHours[h] = (peakHours[h] || 0) + 1;
    }
  }

  const availableDates = db
    .prepare("SELECT DISTINCT boothDate FROM parties ORDER BY boothDate DESC")
    .all()
    .map((r) => r.boothDate);

  res.json({ date, totalParties: completed.length, totalIndividuals, noShows, avgPartySize, avgWaitMinutes, peakHours, availableDates });
});

// ── Serve HTML pages ───────────────────────────────────────────────────────────

const pages = ["queue", "login", "admin", "stats"];
pages.forEach((page) => {
  app.get(`/${page}`, (req, res) => {
    res.sendFile(path.join(__dirname, "public", `${page}.html`));
  });
});

app.listen(PORT, () => {
  console.log(`\n✅ Booth Manager running at http://localhost:${PORT}\n`);
  console.log("  Sign-up page : http://localhost:" + PORT);
  console.log("  Queue display: http://localhost:" + PORT + "/queue");
  console.log("  Staff login  : http://localhost:" + PORT + "/login");
  console.log("  Admin panel  : http://localhost:" + PORT + "/admin");
  console.log("  Stats        : http://localhost:" + PORT + "/stats\n");
});
