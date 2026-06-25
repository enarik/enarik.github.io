// Shared API helpers and utilities

const API = {
  async get(url) {
    const res = await fetch(url);
    if (!res.ok) throw await res.json();
    return res.json();
  },
  async post(url, body) {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) throw await res.json();
    return res.json();
  },
  async patch(url, body) {
    const res = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) throw await res.json();
    return res.json();
  },
  async delete(url) {
    const res = await fetch(url, { method: "DELETE" });
    if (!res.ok) throw await res.json();
    return res.json();
  },
};

function formatWait(minutes) {
  if (!minutes && minutes !== 0) return "—";
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function formatTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatHour(h) {
  if (h === 0) return "12am";
  if (h < 12) return `${h}am`;
  if (h === 12) return "12pm";
  return `${h - 12}pm`;
}

function statusBadgeClass(status) {
  const map = { waiting: "badge-waiting", notified: "badge-notified", "in-booth": "badge-in-booth", completed: "badge-completed", "no-show": "badge-no-show" };
  return "badge " + (map[status] || "badge-waiting");
}

function statusLabel(status) {
  const map = { waiting: "Waiting", notified: "Notified", "in-booth": "In Booth", completed: "Completed", "no-show": "No Show" };
  return map[status] || status;
}

// Toast notifications
const toastContainer = document.createElement("div");
toastContainer.className = "toast-container";
document.addEventListener("DOMContentLoaded", () => document.body.appendChild(toastContainer));

function showToast(msg, type = "") {
  const el = document.createElement("div");
  el.className = "toast " + type;
  el.textContent = msg;
  toastContainer.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// Auth guard — redirects to login if not authenticated
async function requireAuth(allowedRoles) {
  try {
    const data = await API.get("/api/auth/me");
    if (allowedRoles && !allowedRoles.includes(data.role)) {
      window.location.href = "/admin";
      return null;
    }
    return data.role;
  } catch {
    window.location.href = "/login?from=" + encodeURIComponent(window.location.pathname);
    return null;
  }
}

// Simple modal helper
function showModal(html, onReady) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `<div class="modal">${html}</div>`;
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  if (onReady) onReady(overlay.querySelector(".modal"));
  return overlay;
}
