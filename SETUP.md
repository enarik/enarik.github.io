# Booth Manager — Setup Guide (Plain HTML/JS Version)

## Prerequisites
- Node.js 18+ — download at https://nodejs.org

---

## 1. Install dependencies
```bash
cd "/Users/tylerk/Desktop/FS App HTML"
npm install
```

## 2. Configure environment
```bash
cp .env.example .env
```
Edit `.env`:
- `SESSION_SECRET` — any long random string
- `GREETER_PASSWORD` / `ADMIN_PASSWORD` — your staff passwords
- Twilio + SendGrid credentials (leave `NOTIFY_TEST_MODE=true` while testing — notifications log to console instead of sending)

## 3. Start the server
```bash
npm start
```
Open http://localhost:3000

The SQLite database is created automatically at `db/booth.sqlite` on first run.

---

## Pages

| URL | Audience | Description |
|-----|----------|-------------|
| `http://localhost:3000` | Public | Attendee sign-up form |
| `/queue` | Public display screen | Live waitlist, auto-refreshes every 5s |
| `/login` | Staff | Role + password login |
| `/admin` | Staff | Waitlist, check in/out, tables, notifications |
| `/stats` | Admin only | Daily stats + calendar history |

## Roles

| Role | Permissions |
|------|-------------|
| **Greeter** | Send notifications, check in/out, assign seats, mark no-shows, edit parties |
| **Admin** | Everything above + delete entries, add/remove tables, view stats |

---

## Deploying

### Railway (easy, free tier available)
1. Push to a GitHub repo
2. New project → Deploy from GitHub
3. Add environment variables in Railway dashboard
4. Set `PORT` to whatever Railway assigns (it sets this automatically)

### Render
Same as Railway — connect GitHub repo, set env vars, deploy.

### Any Linux VPS
```bash
npm install
npm start
# use pm2 or systemd to keep it running
```

---

## Adding branding
- Replace the `Logo` / `Your Logo Here` placeholder divs in each HTML file with an `<img>` tag
- Brand colors: edit `--brand` values in `public/css/style.css`
- App name: update `<title>` tags in each HTML file
