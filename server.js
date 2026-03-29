const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

const app = express();
const PORT = 3456;

// --- Database Setup ---
const fs = require('fs');
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

const db = new Database(path.join(dataDir, 'ideas.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL DEFAULT 'Sans titre',
    content TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'idée',
    pinned INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

// --- Middleware ---
app.use(express.json());

// --- API Routes ---
// List all notes
app.get('/api/notes', (req, res) => {
  let query = 'SELECT * FROM notes';
  const params = [];
  const conditions = [];

  if (req.query.search) {
    conditions.push('(title LIKE ? OR content LIKE ?)');
    const s = `%${req.query.search}%`;
    params.push(s, s);
  }
  if (req.query.category) {
    conditions.push('category = ?');
    params.push(req.query.category);
  }
  if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
  query += ' ORDER BY pinned DESC, updated_at DESC';

  const notes = db.prepare(query).all(...params);
  res.json(notes);
});

// Create note
app.post('/api/notes', (req, res) => {
  const { title, content, category } = req.body;
  const stmt = db.prepare(
    'INSERT INTO notes (title, content, category) VALUES (?, ?, ?)'
  );
  const result = stmt.run(
    title || 'Sans titre',
    content || '',
    category || 'idée'
  );
  const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(note);
});

// Update note
app.put('/api/notes/:id', (req, res) => {
  const { title, content, category } = req.body;
  const stmt = db.prepare(
    'UPDATE notes SET title = ?, content = ?, category = ?, updated_at = datetime(\'now\') WHERE id = ?'
  );
  stmt.run(title, content, category, req.params.id);
  const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(req.params.id);
  if (!note) return res.status(404).json({ error: 'Not found' });
  res.json(note);
});

// Delete note
app.delete('/api/notes/:id', (req, res) => {
  const result = db.prepare('DELETE FROM notes WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

// Toggle pin
app.patch('/api/notes/:id/pin', (req, res) => {
  const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(req.params.id);
  if (!note) return res.status(404).json({ error: 'Not found' });
  db.prepare(
    'UPDATE notes SET pinned = ?, updated_at = datetime(\'now\') WHERE id = ?'
  ).run(note.pinned ? 0 : 1, req.params.id);
  const updated = db.prepare('SELECT * FROM notes WHERE id = ?').get(req.params.id);
  res.json(updated);
});

// --- Frontend ---
app.get('/', (req, res) => {
  res.send(HTML);
});

const HTML = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="theme-color" content="#0a0a0f">
<title>Ideas Board</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{
  --bg:#0a0a0f;--surface:#16161f;--border:#2a2a3a;--text:#f0f0f0;
  --muted:#888;--accent:#a78bfa;--danger:#ef4444;--radius:12px;
}
html,body{height:100%}
body{
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
  background:var(--bg);color:var(--text);line-height:1.5;
  -webkit-tap-highlight-color:transparent;overflow-x:hidden;
}
button,input,select,textarea{
  font-family:inherit;font-size:16px;color:var(--text);
  background:var(--surface);border:1px solid var(--border);
  border-radius:var(--radius);padding:12px;
  -webkit-appearance:none;appearance:none;
}
button{cursor:pointer;min-height:44px;min-width:44px;transition:all .2s}
button:active{transform:scale(.96);opacity:.8}
input:focus,textarea:focus,select:focus{outline:none;border-color:var(--accent)}

/* Header */
.header{
  position:sticky;top:0;z-index:100;
  background:var(--bg);padding:12px 16px;
  border-bottom:1px solid var(--border);
}
.header h1{font-size:20px;font-weight:700;margin-bottom:10px;display:flex;align-items:center;gap:8px}
.header h1 span{font-size:14px;color:var(--muted);font-weight:400}

/* Search */
.search-row{display:flex;gap:8px;margin-bottom:10px}
.search-row input{flex:1;padding:10px 14px;border-radius:24px;font-size:15px}
.search-row button{padding:10px 16px;border-radius:24px;background:var(--accent);color:#000;font-weight:600;white-space:nowrap}

/* Filters */
.filters{display:flex;gap:6px;overflow-x:auto;padding-bottom:4px;-webkit-overflow-scrolling:touch;scrollbar-width:none}
.filters::-webkit-scrollbar{display:none}
.filter-btn{
  padding:8px 14px;border-radius:20px;font-size:13px;white-space:nowrap;
  background:transparent;border:1px solid var(--border);min-height:36px;
}
.filter-btn.active{background:var(--accent);color:#000;border-color:var(--accent)}

/* Notes Grid */
.notes-container{padding:16px;padding-bottom:100px}
.notes-grid{display:grid;gap:12px;grid-template-columns:1fr}
@media(min-width:600px){.notes-grid{grid-template-columns:repeat(2,1fr)}}
@media(min-width:900px){.notes-grid{grid-template-columns:repeat(3,1fr)}}

/* Note Card */
.note-card{
  background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);
  padding:16px;transition:all .2s;position:relative;
  animation:fadeIn .3s ease;
}
.note-card:active{transform:scale(.98)}
.note-card.pinned{border-color:var(--accent);box-shadow:0 0 12px rgba(167,139,250,.15)}
.note-header{display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:8px}
.note-title{font-size:16px;font-weight:600;word-break:break-word}
.note-meta{display:flex;align-items:center;gap:6px;margin-bottom:8px;flex-wrap:wrap}
.note-category{font-size:12px;padding:3px 8px;border-radius:12px;background:rgba(167,139,250,.15);color:var(--accent)}
.note-date{font-size:11px;color:var(--muted)}
.note-content{font-size:14px;color:var(--muted);word-break:break-word;white-space:pre-wrap;max-height:120px;overflow:hidden}
.note-actions{display:flex;gap:6px;margin-top:12px}
.note-actions button{flex:1;padding:8px;font-size:13px;border-radius:8px;min-height:40px}

@keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}

/* FAB */
.fab{
  position:fixed;bottom:24px;right:24px;z-index:200;
  width:56px;height:56px;border-radius:50%;
  background:var(--accent);color:#000;font-size:28px;font-weight:700;
  border:none;box-shadow:0 4px 20px rgba(167,139,250,.4);
  display:flex;align-items:center;justify-content:center;
}
.fab:active{transform:scale(.9)}

/* Modal Overlay */
.modal-overlay{
  position:fixed;inset:0;z-index:300;
  background:rgba(0,0,0,.6);backdrop-filter:blur(4px);
  opacity:0;pointer-events:none;transition:opacity .3s;
  display:flex;align-items:flex-end;justify-content:center;
}
.modal-overlay.open{opacity:1;pointer-events:all}

/* Bottom Sheet Modal */
.modal{
  width:100%;max-width:500px;max-height:90vh;overflow-y:auto;
  background:var(--surface);border-radius:20px 20px 0 0;
  padding:24px 20px 32px;transform:translateY(100%);
  transition:transform .3s cubic-bezier(.32,.72,0,1);
}
.modal-overlay.open .modal{transform:translateY(0)}
@media(min-width:600px){
  .modal-overlay{align-items:center}
  .modal{border-radius:20px;max-height:80vh}
}
.modal h2{font-size:20px;margin-bottom:20px;display:flex;align-items:center;gap:8px}
.modal label{display:block;font-size:13px;color:var(--muted);margin-bottom:4px;margin-top:14px}
.modal input,.modal textarea,.modal select{width:100%}
.modal textarea{min-height:120px;resize:vertical}
.modal select{padding:12px}
.modal-actions{display:flex;gap:10px;margin-top:24px}
.modal-actions button{flex:1;padding:14px;font-weight:600;font-size:16px;border-radius:var(--radius)}
.btn-primary{background:var(--accent);color:#000;border:none}
.btn-secondary{background:transparent;border:1px solid var(--border)}
.btn-danger{background:var(--danger);color:#fff;border:none}

/* Empty state */
.empty{text-align:center;padding:60px 20px;color:var(--muted)}
.empty-icon{font-size:48px;margin-bottom:16px}
.empty p{font-size:15px}

/* Toast */
.toast{
  position:fixed;bottom:90px;left:50%;transform:translateX(-50%) translateY(20px);
  background:var(--surface);border:1px solid var(--border);
  padding:12px 20px;border-radius:12px;font-size:14px;
  opacity:0;transition:all .3s;z-index:400;pointer-events:none;
  box-shadow:0 4px 20px rgba(0,0,0,.4);
}
.toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
</style>
</head>
<body>

<div class="header">
  <h1>📋 Ideas Board <span>v1.1</span></h1>
  <div class="search-row">
    <input type="text" id="searchInput" placeholder="🔍 Rechercher...">
    <button onclick="loadNotes()">Filtrer</button>
  </div>
  <div class="filters">
    <button class="filter-btn active" data-cat="" onclick="setFilter(this,'')">Tous</button>
    <button class="filter-btn" data-cat="idée" onclick="setFilter(this,'idée')">💡 Idée</button>
    <button class="filter-btn" data-cat="todo" onclick="setFilter(this,'todo')">✅ Todo</button>
    <button class="filter-btn" data-cat="projet" onclick="setFilter(this,'projet')">🚀 Projet</button>
    <button class="filter-btn" data-cat="bug" onclick="setFilter(this,'bug')">🐛 Bug</button>
    <button class="filter-btn" data-cat="note" onclick="setFilter(this,'note')">📝 Note</button>
  </div>
</div>

<div class="notes-container">
  <div id="notesGrid" class="notes-grid"></div>
  <div id="emptyState" class="empty" style="display:none">
    <div class="empty-icon">📭</div>
    <p>Aucune note ici. Appuie sur + pour en créer une !</p>
  </div>
</div>

<button class="fab" onclick="openModal()">+</button>

<div class="modal-overlay" id="modalOverlay" onclick="closeModalOutside(event)">
  <div class="modal" onclick="event.stopPropagation()">
    <h2 id="modalTitle">📝 Nouvelle note</h2>
    <input type="hidden" id="noteId">
    <label>Titre</label>
    <input type="text" id="noteTitle" placeholder="Titre de la note...">
    <label>Catégorie</label>
    <select id="noteCategory">
      <option value="idée">💡 Idée</option>
      <option value="todo">✅ Todo</option>
      <option value="projet">🚀 Projet</option>
      <option value="bug">🐛 Bug</option>
      <option value="note">📝 Note</option>
    </select>
    <label>Contenu</label>
    <textarea id="noteContent" placeholder="Écris ton idée ici..."></textarea>
    <div class="modal-actions">
      <button class="btn-secondary" onclick="closeModal()">Annuler</button>
      <button class="btn-primary" id="saveBtn" onclick="saveNote()">Enregistrer</button>
    </div>
    <div id="deleteSection" style="display:none;margin-top:10px">
      <button class="btn-danger" style="width:100%;padding:14px;font-weight:600" onclick="deleteNote()">🗑 Supprimer</button>
    </div>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
let currentFilter = '';

const CATEGORY_EMOJI = {'idée':'💡','todo':'✅','projet':'🚀','bug':'🐛','note':'📝'};

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2000);
}

function setFilter(btn, cat) {
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentFilter = cat;
  loadNotes();
}

async function loadNotes() {
  const search = document.getElementById('searchInput').value;
  let url = '/api/notes?';
  if (search) url += 'search=' + encodeURIComponent(search) + '&';
  if (currentFilter) url += 'category=' + encodeURIComponent(currentFilter);

  const res = await fetch(url);
  const notes = await res.json();
  renderNotes(notes);
}

function renderNotes(notes) {
  const grid = document.getElementById('notesGrid');
  const empty = document.getElementById('emptyState');

  if (!notes.length) {
    grid.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  grid.innerHTML = notes.map(n => {
    const emoji = CATEGORY_EMOJI[n.category] || '📝';
    const date = new Date(n.updated_at).toLocaleDateString('fr-FR', {
      day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'
    });
    const pinnedClass = n.pinned ? 'pinned' : '';
    const pinBtn = n.pinned ? '📌' : '📍';

    return \`
      <div class="note-card \${pinnedClass}">
        <div class="note-header">
          <div class="note-title">\${esc(n.title)}</div>
        </div>
        <div class="note-meta">
          <span class="note-category">\${emoji} \${n.category}</span>
          <span class="note-date">\${date}</span>
        </div>
        \${n.content ? '<div class="note-content">' + esc(n.content) + '</div>' : ''}
        <div class="note-actions">
          <button onclick="editNote(\${n.id})" style="background:rgba(167,139,250,.1);color:var(--accent)">✏️ Modifier</button>
          <button onclick="togglePin(\${n.id})" style="background:rgba(167,139,250,.1);color:var(--accent)">\${pinBtn} Pin</button>
        </div>
      </div>
    \`;
  }).join('');
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function openModal(note = null) {
  const overlay = document.getElementById('modalOverlay');
  document.getElementById('modalTitle').innerHTML = note ? '✏️ Modifier la note' : '📝 Nouvelle note';
  document.getElementById('noteId').value = note ? note.id : '';
  document.getElementById('noteTitle').value = note ? note.title : '';
  document.getElementById('noteContent').value = note ? note.content : '';
  document.getElementById('noteCategory').value = note ? note.category : 'idée';
  document.getElementById('deleteSection').style.display = note ? 'block' : 'none';
  overlay.classList.add('open');
  setTimeout(() => document.getElementById('noteTitle').focus(), 300);
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('open');
}

function closeModalOutside(e) {
  if (e.target === e.currentTarget) closeModal();
}

async function editNote(id) {
  const res = await fetch('/api/notes');
  const notes = await res.json();
  const note = notes.find(n => n.id === id);
  if (note) openModal(note);
}

async function saveNote() {
  const id = document.getElementById('noteId').value;
  const data = {
    title: document.getElementById('noteTitle').value || 'Sans titre',
    content: document.getElementById('noteContent').value,
    category: document.getElementById('noteCategory').value
  };

  if (id) {
    await fetch('/api/notes/' + id, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data) });
    showToast('✅ Note modifiée');
  } else {
    await fetch('/api/notes', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data) });
    showToast('✅ Note créée');
  }
  closeModal();
  loadNotes();
}

async function togglePin(id) {
  await fetch('/api/notes/' + id + '/pin', { method:'PATCH' });
  showToast('📌 Pin mis à jour');
  loadNotes();
}

async function deleteNote() {
  const id = document.getElementById('noteId').value;
  if (!confirm('Supprimer cette note ?')) return;
  await fetch('/api/notes/' + id, { method:'DELETE' });
  showToast('🗑 Note supprimée');
  closeModal();
  loadNotes();
}

// Search on Enter
document.getElementById('searchInput').addEventListener('keyup', e => {
  if (e.key === 'Enter') loadNotes();
});
// Live search with debounce
let searchTimer;
document.getElementById('searchInput').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadNotes, 300);
});

// Keyboard shortcut: Escape to close modal
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
});

// Init
loadNotes();
</script>
</body>
</html>`;

// --- Start Server ---
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}

app.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log(`Ideas Board v1.1 running!`);
  console.log(`Local:   http://localhost:${PORT}`);
  console.log(`Network: http://${ip}:${PORT}`);
});
