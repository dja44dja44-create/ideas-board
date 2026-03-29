const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3456;
const DATA_FILE = path.join(__dirname, 'notes.json');

app.use(express.json());

// --- API ---

function loadNotes() {
  if (!fs.existsSync(DATA_FILE)) return [];
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function saveNotes(notes) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(notes, null, 2));
}

// Get all notes
app.get('/api/notes', (req, res) => {
  res.json(loadNotes());
});

// Create note
app.post('/api/notes', (req, res) => {
  const notes = loadNotes();
  const note = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    title: req.body.title || 'Sans titre',
    content: req.body.content || '',
    category: req.body.category || 'idée',
    pinned: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  notes.unshift(note);
  saveNotes(notes);
  res.json(note);
});

// Update note
app.put('/api/notes/:id', (req, res) => {
  const notes = loadNotes();
  const idx = notes.findIndex(n => n.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  notes[idx] = { ...notes[idx], ...req.body, updatedAt: new Date().toISOString() };
  saveNotes(notes);
  res.json(notes[idx]);
});

// Delete note
app.delete('/api/notes/:id', (req, res) => {
  let notes = loadNotes();
  notes = notes.filter(n => n.id !== req.params.id);
  saveNotes(notes);
  res.json({ ok: true });
});

// --- Frontend ---
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
<title>💡 Idées</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  :root {
    --bg: #0a0a0f; --surface: #16161f; --surface2: #1e1e2a;
    --border: #2a2a3a; --text: #f0f0f0; --muted: #888;
    --accent: #a78bfa; --accent2: #7c3aed;
    --danger: #ef4444; --pin: #fbbf24;
  }
  body { font-family: -apple-system, system-ui, sans-serif; background: var(--bg); color: var(--text); min-height: 100dvh; }

  /* Header */
  .header { position: sticky; top: 0; z-index: 10; background: var(--bg); border-bottom: 1px solid var(--border); padding: 12px 16px; display: flex; align-items: center; justify-content: space-between; }
  .header h1 { font-size: 18px; font-weight: 700; }
  .header h1 span { color: var(--accent); }
  .search { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 8px 12px; color: var(--text); font-size: 14px; width: 100%; margin-top: 8px; outline: none; }
  .search:focus { border-color: var(--accent); }

  /* Categories */
  .cats { display: flex; gap: 8px; padding: 12px 16px; overflow-x: auto; scrollbar-width: none; }
  .cats::-webkit-scrollbar { display: none; }
  .cat { padding: 6px 14px; border-radius: 20px; font-size: 13px; background: var(--surface); border: 1px solid var(--border); white-space: nowrap; cursor: pointer; transition: all .2s; color: var(--muted); }
  .cat.active { background: var(--accent2); border-color: var(--accent2); color: #fff; }

  /* Notes grid */
  .notes { padding: 8px 16px 100px; display: grid; gap: 12px; }
  .note { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 14px; cursor: pointer; transition: all .2s; position: relative; }
  .note:active { transform: scale(.98); }
  .note.pinned { border-color: var(--pin); }
  .note .pin-badge { position: absolute; top: 8px; right: 8px; font-size: 14px; }
  .note h3 { font-size: 15px; font-weight: 600; margin-bottom: 6px; padding-right: 24px; }
  .note p { font-size: 13px; color: var(--muted); line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  .note .meta { margin-top: 10px; display: flex; justify-content: space-between; align-items: center; }
  .note .tag { font-size: 11px; padding: 2px 8px; border-radius: 8px; background: var(--surface2); color: var(--accent); }
  .note .date { font-size: 11px; color: var(--muted); }

  /* FAB */
  .fab { position: fixed; bottom: 24px; right: 24px; width: 56px; height: 56px; border-radius: 50%; background: var(--accent2); border: none; color: #fff; font-size: 28px; box-shadow: 0 4px 20px rgba(124,58,237,.4); cursor: pointer; z-index: 20; display: flex; align-items: center; justify-content: center; }

  /* Modal */
  .overlay { position: fixed; inset: 0; background: rgba(0,0,0,.7); z-index: 30; display: none; align-items: flex-end; }
  .overlay.open { display: flex; }
  .modal { background: var(--surface); width: 100%; max-height: 90dvh; border-radius: 20px 20px 0 0; padding: 20px; overflow-y: auto; animation: slideUp .25s ease; }
  @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
  .modal h2 { font-size: 18px; margin-bottom: 16px; }
  .modal input, .modal textarea, .modal select { width: 100%; background: var(--bg); border: 1px solid var(--border); border-radius: 10px; padding: 12px; color: var(--text); font-size: 15px; margin-bottom: 12px; outline: none; font-family: inherit; }
  .modal input:focus, .modal textarea:focus { border-color: var(--accent); }
  .modal textarea { min-height: 150px; resize: vertical; }
  .modal .actions { display: flex; gap: 10px; margin-top: 8px; }
  .modal button { flex: 1; padding: 12px; border-radius: 10px; border: none; font-size: 15px; font-weight: 600; cursor: pointer; }
  .btn-save { background: var(--accent2); color: #fff; }
  .btn-cancel { background: var(--surface2); color: var(--muted); }
  .btn-delete { background: var(--danger); color: #fff; flex: 0.5; }
  .btn-pin { background: var(--surface2); font-size: 20px; flex: 0.4; }

  /* Empty */
  .empty { text-align: center; padding: 60px 20px; color: var(--muted); }
  .empty .emoji { font-size: 48px; margin-bottom: 12px; }
</style>
</head>
<body>

<div class="header">
  <h1>💡 <span>Idées</span></h1>
</div>
<input class="search" id="search" placeholder="Rechercher..." oninput="render()">

<div class="cats" id="cats"></div>
<div class="notes" id="notes"></div>
<div class="empty" id="empty" style="display:none"><div class="emoji">🧠</div>Aucune note. Appuie + pour commencer.</div>

<button class="fab" onclick="openModal()">+</button>

<div class="overlay" id="overlay" onclick="if(event.target===this)closeModal()">
  <div class="modal">
    <h2 id="modalTitle">Nouvelle idée</h2>
    <input id="inpTitle" placeholder="Titre (optionnel)">
    <textarea id="inpContent" placeholder="Écris ton idée ici..."></textarea>
    <select id="inpCat">
      <option value="idée">💡 Idée</option>
      <option value="todo">✅ Todo</option>
      <option value="projet">🚀 Projet</option>
      <option value="bug">🐛 Bug</option>
      <option value="note">📝 Note</option>
    </select>
    <div class="actions">
      <button class="btn-cancel" onclick="closeModal()">Annuler</button>
      <button class="btn-pin" id="btnPin" onclick="togglePin()" title="Épingler">📌</button>
      <button class="btn-delete" id="btnDelete" onclick="deleteNote()" style="display:none">🗑</button>
      <button class="btn-save" onclick="saveNote()">Sauver</button>
    </div>
  </div>
</div>

<script>
let notes = [], editId = null, activeCat = 'all';

const CATEGORIES = ['idée','todo','projet','bug','note'];
const CAT_EMOJI = { idée:'💡', todo:'✅', projet:'🚀', bug:'🐛', note:'📝' };

async function fetchNotes() {
  notes = await (await fetch('/api/notes')).json();
  render();
}

function render() {
  const q = document.getElementById('search').value.toLowerCase();
  let filtered = notes.filter(n =>
    (!q || n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q)) &&
    (activeCat === 'all' || n.category === activeCat)
  );

  // Sort: pinned first, then by date
  filtered.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || new Date(b.updatedAt) - new Date(a.updatedAt));

  // Categories
  let catHtml = '<div class="cat ' + (activeCat === 'all' ? 'active' : '') + '" onclick="setCat(\'all\')">Tous</div>';
  CATEGORIES.forEach(function(c) {
    catHtml += '<div class="cat ' + (activeCat === c ? 'active' : '') + '" onclick="setCat(\'' + c + '\')">' + CAT_EMOJI[c] + ' ' + c + '</div>';
  });
  document.getElementById('cats').innerHTML = catHtml;

  // Notes
  var notesHtml = '';
  filtered.forEach(function(n) {
    var d = new Date(n.updatedAt);
    var dateStr = d.toLocaleDateString('fr', {day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
    notesHtml += '<div class="note ' + (n.pinned ? 'pinned' : '') + '" onclick="openModal(\'' + n.id + '\')">' +
      (n.pinned ? '<span class="pin-badge">📌</span>' : '') +
      '<h3>' + esc(n.title) + '</h3>' +
      '<p>' + esc(n.content) + '</p>' +
      '<div class="meta">' +
      '<span class="tag">' + (CAT_EMOJI[n.category] || '') + ' ' + n.category + '</span>' +
      '<span class="date">' + dateStr + '</span>' +
      '</div></div>';
  });
  document.getElementById('notes').innerHTML = notesHtml;

  document.getElementById('empty').style.display = filtered.length ? 'none' : 'block';
}

function setCat(c) { activeCat = c; render(); }

function esc(s) { return s.replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function openModal(id) {
  editId = id || null;
  const n = notes.find(x => x.id === id);
  document.getElementById('modalTitle').textContent = n ? 'Modifier' : 'Nouvelle idée';
  document.getElementById('inpTitle').value = n ? n.title : '';
  document.getElementById('inpContent').value = n ? n.content : '';
  document.getElementById('inpCat').value = n ? n.category : 'idée';
  document.getElementById('btnDelete').style.display = n ? 'block' : 'none';
  document.getElementById('btnPin').textContent = (n && n.pinned) ? '📌' : '📍';
  document.getElementById('overlay').classList.add('open');
  document.getElementById('inpTitle').focus();
}

function closeModal() { document.getElementById('overlay').classList.remove('open'); editId = null; }

let tempPin = false;
function togglePin() {
  tempPin = !tempPin;
  const n = notes.find(x => x.id === editId);
  if (n) tempPin = !n.pinned;
  document.getElementById('btnPin').textContent = tempPin ? '📌' : '📍';
}

async function saveNote() {
  const body = {
    title: document.getElementById('inpTitle').value,
    content: document.getElementById('inpContent').value,
    category: document.getElementById('inpCat').value,
  };
  const n = notes.find(x => x.id === editId);
  if (n) body.pinned = tempPin ? !n.pinned : n.pinned;

  if (editId) {
    await fetch('/api/notes/' + editId, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
  } else {
    await fetch('/api/notes', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
  }
  closeModal();
  fetchNotes();
}

async function deleteNote() {
  if (!confirm('Supprimer ?')) return;
  await fetch('/api/notes/' + editId, { method: 'DELETE' });
  closeModal();
  fetchNotes();
}

fetchNotes();
</script>
</body>
</html>`);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`💡 Ideas Board running at http://localhost:${PORT}`);
  console.log(`📱 From phone: http://${getLocalIP()}:${PORT}`);
});

function getLocalIP() {
  const { networkInterfaces } = require('os');
  for (const iface of Object.values(networkInterfaces())) {
    for (const i of iface) {
      if (i.family === 'IPv4' && !i.internal) return i.address;
    }
  }
  return 'YOUR_IP';
}
