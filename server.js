const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const PORT = 3456;

// --- Database Setup ---
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

const db = new Database(path.join(dataDir, 'ideas.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Migrate: add new columns if they don't exist
const cols = db.prepare("PRAGMA table_info(notes)").all().map(c => c.name);
const addCol = (name, type) => {
  if (!cols.includes(name)) {
    db.exec(`ALTER TABLE notes ADD COLUMN ${name} ${type}`);
    console.log(`Migrated: added column ${name}`);
  }
};

// Ensure table exists first (old schema or new)
db.exec(`CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL DEFAULT 'Sans titre',
  content TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'idée',
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

// Add new columns for v1.2
addCol('cost', 'INTEGER DEFAULT 0');
addCol('feasibility', 'INTEGER DEFAULT 0');
addCol('potential', 'INTEGER DEFAULT 0');
addCol('difficulty', 'INTEGER DEFAULT 0');
addCol('parent_id', 'INTEGER DEFAULT NULL');

// --- Middleware ---
app.use(express.json());

// --- Categories ---
const CATEGORIES = [
  { value: 'entreprise', label: '🏢 Entreprise' },
  { value: 'sas', label: '💼 S.A.S' },
  { value: 'business', label: '📊 Business' },
  { value: 'note', label: '📝 Note' },
  { value: 'idée', label: '💡 Idée' },
];

// --- API Routes ---

// List notes
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

  // parent_id filter
  if (req.query.parent_id === 'null' || req.query.parent_id === '') {
    conditions.push('parent_id IS NULL');
  } else if (req.query.parent_id !== undefined) {
    conditions.push('parent_id = ?');
    params.push(parseInt(req.query.parent_id));
  }

  if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');

  // Sort
  const sortField = req.query.sort;
  const sortOrder = req.query.order === 'asc' ? 'ASC' : 'DESC';
  const validSorts = ['cost', 'feasibility', 'potential', 'difficulty', 'date'];
  if (sortField && validSorts.includes(sortField)) {
    const col = sortField === 'date' ? 'updated_at' : sortField;
    query += ` ORDER BY pinned DESC, ${col} ${sortOrder}`;
  } else {
    query += ' ORDER BY pinned DESC, updated_at DESC';
  }

  const notes = db.prepare(query).all(...params);
  res.json(notes);
});

// Get single note
app.get('/api/notes/:id', (req, res) => {
  const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(req.params.id);
  if (!note) return res.status(404).json({ error: 'Not found' });
  res.json(note);
});

// Create note
app.post('/api/notes', (req, res) => {
  const { title, content, category, cost, feasibility, potential, difficulty, parent_id } = req.body;
  const stmt = db.prepare(
    'INSERT INTO notes (title, content, category, cost, feasibility, potential, difficulty, parent_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const result = stmt.run(
    title || 'Sans titre',
    content || '',
    category || 'idée',
    parseInt(cost) || 0,
    parseInt(feasibility) || 0,
    parseInt(potential) || 0,
    parseInt(difficulty) || 0,
    parent_id ? parseInt(parent_id) : null
  );
  const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(note);
});

// Update note
app.put('/api/notes/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM notes WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const { title, content, category, cost, feasibility, potential, difficulty, parent_id } = req.body;
  db.prepare(
    `UPDATE notes SET title = ?, content = ?, category = ?, cost = ?, feasibility = ?, potential = ?, difficulty = ?, parent_id = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(
    title ?? existing.title,
    content ?? existing.content,
    category ?? existing.category,
    cost !== undefined ? parseInt(cost) || 0 : existing.cost,
    feasibility !== undefined ? parseInt(feasibility) || 0 : existing.feasibility,
    potential !== undefined ? parseInt(potential) || 0 : existing.potential,
    difficulty !== undefined ? parseInt(difficulty) || 0 : existing.difficulty,
    parent_id !== undefined ? (parent_id ? parseInt(parent_id) : null) : existing.parent_id,
    req.params.id
  );
  const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(req.params.id);
  res.json(note);
});

// Delete note
app.delete('/api/notes/:id', (req, res) => {
  // Also delete children
  db.prepare('DELETE FROM notes WHERE parent_id = ?').run(req.params.id);
  const result = db.prepare('DELETE FROM notes WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

// Toggle pin
app.patch('/api/notes/:id/pin', (req, res) => {
  const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(req.params.id);
  if (!note) return res.status(404).json({ error: 'Not found' });
  db.prepare(
    `UPDATE notes SET pinned = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(note.pinned ? 0 : 1, req.params.id);
  const updated = db.prepare('SELECT * FROM notes WHERE id = ?').get(req.params.id);
  res.json(updated);
});

// Get children (sub-ideas)
app.get('/api/notes/:id/children', (req, res) => {
  const parent = db.prepare('SELECT * FROM notes WHERE id = ?').get(req.params.id);
  if (!parent) return res.status(404).json({ error: 'Not found' });
  const children = db.prepare('SELECT * FROM notes WHERE parent_id = ? ORDER BY pinned DESC, updated_at DESC').all(req.params.id);
  res.json(children);
});

// Categories endpoint
app.get('/api/categories', (req, res) => {
  res.json(CATEGORIES);
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
  --star:#fbbf24;--star-empty:#333;
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

/* Back bar */
.back-bar{display:none;align-items:center;gap:10px;margin-bottom:10px;padding:8px 0}
.back-bar.visible{display:flex}
.back-btn{
  background:rgba(167,139,250,.15);color:var(--accent);border:none;
  padding:8px 14px;border-radius:20px;font-size:14px;font-weight:600;min-height:40px;
}
.back-bar .project-title{font-size:16px;font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* Search + Sort row */
.top-row{display:flex;gap:8px;margin-bottom:10px}
.top-row input{flex:1;padding:10px 14px;border-radius:24px;font-size:15px}
.sort-select{padding:10px 12px;border-radius:24px;font-size:13px;min-width:100px;max-width:140px}

/* Category pills */
.cat-pills{display:flex;gap:8px;overflow-x:auto;padding-bottom:6px;-webkit-overflow-scrolling:touch;scrollbar-width:none}
.cat-pills::-webkit-scrollbar{display:none}
.cat-pill{
  padding:10px 18px;border-radius:24px;font-size:14px;white-space:nowrap;
  background:transparent;border:1px solid var(--border);min-height:48px;
  display:flex;align-items:center;gap:6px;font-weight:500;
}
.cat-pill.active{background:var(--accent);color:#000;border-color:var(--accent);font-weight:700}

/* Notes Grid */
.notes-container{padding:16px;padding-bottom:100px}
.notes-grid{display:grid;gap:12px;grid-template-columns:1fr}
@media(min-width:600px){.notes-grid{grid-template-columns:repeat(2,1fr)}}
@media(min-width:900px){.notes-grid{grid-template-columns:repeat(3,1fr)}}

/* Note Card */
.note-card{
  background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);
  padding:16px;transition:all .2s;position:relative;
  animation:fadeIn .3s ease;cursor:pointer;
}
.note-card:active{transform:scale(.98)}
.note-card.pinned{border-color:var(--accent);box-shadow:0 0 12px rgba(167,139,250,.15)}
.note-header{display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:8px}
.note-title{font-size:16px;font-weight:600;word-break:break-word}
.note-meta{display:flex;align-items:center;gap:6px;margin-bottom:8px;flex-wrap:wrap}
.note-category{font-size:12px;padding:3px 8px;border-radius:12px;background:rgba(167,139,250,.15);color:var(--accent)}
.note-date{font-size:11px;color:var(--muted)}
.note-content{font-size:14px;color:var(--muted);word-break:break-word;white-space:pre-wrap;max-height:120px;overflow:hidden}
.note-ratings{display:flex;gap:10px;margin-top:10px;flex-wrap:wrap}
.rating-item{font-size:12px;color:var(--muted);display:flex;align-items:center;gap:4px}
.rating-item .stars{color:var(--star);letter-spacing:-1px}
.note-actions{display:flex;gap:6px;margin-top:12px}
.note-actions button{flex:1;padding:8px;font-size:13px;border-radius:8px;min-height:40px}
.sub-count{font-size:11px;color:var(--muted);margin-top:6px;display:flex;align-items:center;gap:4px}

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
  width:100%;max-width:500px;max-height:92vh;overflow-y:auto;
  background:var(--surface);border-radius:20px 20px 0 0;
  padding:24px 20px 32px;transform:translateY(100%);
  transition:transform .3s cubic-bezier(.32,.72,0,1);
}
.modal-overlay.open .modal{transform:translateY(0)}
@media(min-width:600px){
  .modal-overlay{align-items:center}
  .modal{border-radius:20px;max-height:85vh}
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

/* Star rating input */
.star-rating{display:flex;gap:4px;margin-top:4px}
.star-rating .star{
  font-size:28px;cursor:pointer;color:var(--star-empty);
  transition:color .15s;min-height:48px;min-width:48px;
  display:flex;align-items:center;justify-content:center;
  background:none;border:none;padding:4px;
}
.star-rating .star.filled{color:var(--star)}
.star-rating .star:active{transform:scale(1.2)}
.rating-row{display:flex;gap:16px;flex-wrap:wrap}
.rating-group{flex:1;min-width:120px}
.rating-group label{margin-bottom:6px}

/* Pin toggle */
.pin-toggle{display:flex;align-items:center;gap:10px;margin-top:14px}
.pin-toggle button{
  padding:10px 18px;border-radius:20px;font-size:14px;
  background:transparent;border:1px solid var(--border);min-height:44px;
}
.pin-toggle button.active{background:var(--accent);color:#000;border-color:var(--accent)}

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
  <h1>📋 Ideas Board <span>v1.2</span></h1>
  <div class="back-bar" id="backBar">
    <button class="back-btn" onclick="goBack()">← Retour</button>
    <div class="project-title" id="projectTitle"></div>
  </div>
  <div class="top-row" id="topRow">
    <input type="text" id="searchInput" placeholder="🔍 Rechercher...">
    <select class="sort-select" id="sortSelect" onchange="loadNotes()">
      <option value="">Trier par...</option>
      <option value="date">📅 Date</option>
      <option value="cost">💰 Coût</option>
      <option value="feasibility">🔧 Faisabilité</option>
      <option value="potential">🚀 Potentiel</option>
      <option value="difficulty">🧱 Difficulté</option>
    </select>
  </div>
  <div class="cat-pills" id="catPills"></div>
</div>

<div class="notes-container">
  <div id="notesGrid" class="notes-grid"></div>
  <div id="emptyState" class="empty" style="display:none">
    <div class="empty-icon">📭</div>
    <p id="emptyMsg">Aucune note ici. Appuie sur + pour en créer une !</p>
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
    <select id="noteCategory"></select>
    <label>Contenu</label>
    <textarea id="noteContent" placeholder="Écris ton idée ici..."></textarea>

    <div class="rating-row">
      <div class="rating-group">
        <label>💰 Coût</label>
        <div class="star-rating" data-field="cost"></div>
      </div>
      <div class="rating-group">
        <label>🔧 Faisabilité</label>
        <div class="star-rating" data-field="feasibility"></div>
      </div>
    </div>
    <div class="rating-row" style="margin-top:8px">
      <div class="rating-group">
        <label>🚀 Potentiel</label>
        <div class="star-rating" data-field="potential"></div>
      </div>
      <div class="rating-group">
        <label>🧱 Difficulté</label>
        <div class="star-rating" data-field="difficulty"></div>
      </div>
    </div>

    <div class="pin-toggle">
      <button id="pinToggleBtn" onclick="togglePinInModal()">📍 Épingler</button>
    </div>

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
const CATEGORIES = [
  { value: 'entreprise', label: '🏢 Entreprise' },
  { value: 'sas', label: '💼 S.A.S' },
  { value: 'business', label: '📊 Business' },
  { value: 'note', label: '📝 Note' },
  { value: 'idée', label: '💡 Idée' },
];

const CAT_EMOJI = {};
CATEGORIES.forEach(c => { CAT_EMOJI[c.value] = c.label.split(' ')[0]; });

let currentFilter = '';
let currentParentId = null; // null = root view, number = viewing children
let currentNotePinned = 0;
const ratings = { cost: 0, feasibility: 0, potential: 0, difficulty: 0 };

// --- Init ---
function init() {
  renderCatPills();
  renderCategorySelect();
  buildStarRatings();
  loadNotes();
}

function renderCatPills() {
  const el = document.getElementById('catPills');
  let html = '<button class="cat-pill active" data-cat="" onclick="setFilter(this,\\'\\')">Tous</button>';
  CATEGORIES.forEach(c => {
    html += \`<button class="cat-pill" data-cat="\${c.value}" onclick="setFilter(this,\\'\${c.value}\\')">\${c.label}</button>\`;
  });
  el.innerHTML = html;
}

function renderCategorySelect() {
  const sel = document.getElementById('noteCategory');
  sel.innerHTML = CATEGORIES.map(c => \`<option value="\${c.value}">\${c.label}</option>\`).join('');
}

function buildStarRatings() {
  document.querySelectorAll('.star-rating').forEach(container => {
    const field = container.dataset.field;
    let html = '';
    for (let i = 1; i <= 5; i++) {
      html += \`<button class="star" data-value="\${i}" onclick="setRating(\\'\${field}\\', \${i})">★</button>\`;
    }
    container.innerHTML = html;
  });
}

function setRating(field, value) {
  ratings[field] = ratings[field] === value ? 0 : value; // toggle off
  updateStarDisplay(field);
}

function updateStarDisplay(field) {
  const container = document.querySelector(\`.star-rating[data-field="\${field}"]\`);
  container.querySelectorAll('.star').forEach(star => {
    const v = parseInt(star.dataset.value);
    star.classList.toggle('filled', v <= ratings[field]);
  });
}

function setAllRatings(note) {
  ['cost', 'feasibility', 'potential', 'difficulty'].forEach(f => {
    ratings[f] = note ? (note[f] || 0) : 0;
    updateStarDisplay(f);
  });
}

// --- Stars display for cards ---
function starsHTML(val) {
  if (!val) return '';
  let s = '';
  for (let i = 1; i <= 5; i++) s += i <= val ? '⭐' : '☆';
  return s;
}

// --- Toast ---
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2000);
}

// --- Filter ---
function setFilter(btn, cat) {
  document.querySelectorAll('.cat-pill').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentFilter = cat;
  loadNotes();
}

// --- Navigation ---
function viewProject(id, title) {
  currentParentId = id;
  document.getElementById('backBar').classList.add('visible');
  document.getElementById('projectTitle').textContent = title;
  document.getElementById('topRow').style.display = 'none';
  document.getElementById('catPills').style.display = 'none';
  loadNotes();
}

function goBack() {
  currentParentId = null;
  document.getElementById('backBar').classList.remove('visible');
  document.getElementById('topRow').style.display = 'flex';
  document.getElementById('catPills').style.display = 'flex';
  loadNotes();
}

// --- Load & Render ---
async function loadNotes() {
  const search = document.getElementById('searchInput').value;
  const sort = document.getElementById('sortSelect').value;
  let url = '/api/notes?';
  if (search) url += 'search=' + encodeURIComponent(search) + '&';
  if (currentFilter) url += 'category=' + encodeURIComponent(currentFilter) + '&';
  if (sort) url += 'sort=' + sort + '&order=desc&';
  if (currentParentId !== null) {
    url += 'parent_id=' + currentParentId + '&';
  } else {
    url += 'parent_id=null&';
  }

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
    document.getElementById('emptyMsg').textContent = currentParentId
      ? 'Aucune sous-idée ici. Appuie sur + pour en ajouter une !'
      : 'Aucune note ici. Appuie sur + pour en créer une !';
    return;
  }
  empty.style.display = 'none';

  grid.innerHTML = notes.map(n => {
    const emoji = CAT_EMOJI[n.category] || '📝';
    const date = new Date(n.updated_at + 'Z').toLocaleDateString('fr-FR', {
      day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'
    });
    const pinnedClass = n.pinned ? 'pinned' : '';
    const pinBtn = n.pinned ? '📌' : '📍';

    // Ratings
    let ratingsHTML = '';
    const ratingItems = [];
    if (n.cost) ratingItems.push(\`<div class="rating-item">💰 <span class="stars">\${starsHTML(n.cost)}</span></div>\`);
    if (n.feasibility) ratingItems.push(\`<div class="rating-item">🔧 <span class="stars">\${starsHTML(n.feasibility)}</span></div>\`);
    if (n.potential) ratingItems.push(\`<div class="rating-item">🚀 <span class="stars">\${starsHTML(n.potential)}</span></div>\`);
    if (n.difficulty) ratingItems.push(\`<div class="rating-item">🧱 <span class="stars">\${starsHTML(n.difficulty)}</span></div>\`);
    if (ratingItems.length) ratingsHTML = '<div class="note-ratings">' + ratingItems.join('') + '</div>';

    // Is this a root note? Show children count
    let subHTML = '';
    if (!n.parent_id) {
      subHTML = \`<div class="sub-count" id="subcount-\${n.id}"></div>\`;
    }

    const clickAction = !n.parent_id
      ? \`onclick="viewProject(\${n.id}, '\\\${esc(n.title)}')"\`
      : '';

    return \`
      <div class="note-card \${pinnedClass}" \${clickAction}>
        <div class="note-header">
          <div class="note-title">\${esc(n.title)}</div>
        </div>
        <div class="note-meta">
          <span class="note-category">\${emoji} \${n.category}</span>
          <span class="note-date">\${date}</span>
        </div>
        \${n.content ? '<div class="note-content">' + esc(n.content) + '</div>' : ''}
        \${ratingsHTML}
        \${subHTML}
        <div class="note-actions" onclick="event.stopPropagation()">
          <button onclick="editNote(\${n.id})" style="background:rgba(167,139,250,.1);color:var(--accent)">✏️ Modifier</button>
          <button onclick="togglePin(\${n.id})" style="background:rgba(167,139,250,.1);color:var(--accent)">\${pinBtn} Pin</button>
        </div>
      </div>
    \`;
  }).join('');

  // Load children counts for root notes
  notes.filter(n => !n.parent_id).forEach(async n => {
    try {
      const r = await fetch('/api/notes/' + n.id + '/children');
      const children = await r.json();
      const el = document.getElementById('subcount-' + n.id);
      if (el && children.length) {
        el.innerHTML = '📂 ' + children.length + ' sous-idée' + (children.length > 1 ? 's' : '');
      }
    } catch(e) {}
  });
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

// --- Modal ---
function openModal(note = null) {
  const overlay = document.getElementById('modalOverlay');
  document.getElementById('modalTitle').innerHTML = note ? '✏️ Modifier' : (currentParentId ? '📌 Nouvelle sous-idée' : '📝 Nouvelle note');
  document.getElementById('noteId').value = note ? note.id : '';
  document.getElementById('noteTitle').value = note ? note.title : '';
  document.getElementById('noteContent').value = note ? note.content : '';
  document.getElementById('noteCategory').value = note ? note.category : (currentParentId ? 'idée' : 'idée');
  document.getElementById('deleteSection').style.display = note ? 'block' : 'none';
  currentNotePinned = note ? note.pinned : 0;
  updatePinBtn();
  setAllRatings(note);
  overlay.classList.add('open');
  setTimeout(() => document.getElementById('noteTitle').focus(), 300);
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('open');
}

function closeModalOutside(e) {
  if (e.target === e.currentTarget) closeModal();
}

function updatePinBtn() {
  const btn = document.getElementById('pinToggleBtn');
  btn.textContent = currentNotePinned ? '📌 Épinglée' : '📍 Épingler';
  btn.classList.toggle('active', !!currentNotePinned);
}

function togglePinInModal() {
  currentNotePinned = currentNotePinned ? 0 : 1;
  updatePinBtn();
}

async function editNote(id) {
  const res = await fetch('/api/notes/' + id);
  const note = await res.json();
  openModal(note);
}

async function saveNote() {
  const id = document.getElementById('noteId').value;
  const data = {
    title: document.getElementById('noteTitle').value || 'Sans titre',
    content: document.getElementById('noteContent').value,
    category: document.getElementById('noteCategory').value,
    cost: ratings.cost,
    feasibility: ratings.feasibility,
    potential: ratings.potential,
    difficulty: ratings.difficulty,
    pinned: currentNotePinned,
  };

  if (currentParentId && !id) {
    data.parent_id = currentParentId;
  }

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

// --- Search ---
document.getElementById('searchInput').addEventListener('keyup', e => {
  if (e.key === 'Enter') loadNotes();
});
let searchTimer;
document.getElementById('searchInput').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadNotes, 300);
});

// --- Keyboard ---
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (document.getElementById('modalOverlay').classList.contains('open')) {
      closeModal();
    } else if (currentParentId !== null) {
      goBack();
    }
  }
});

// --- Init ---
init();
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
  console.log(`Ideas Board v1.2 running!`);
  console.log(`Local:   http://localhost:${PORT}`);
  console.log(`Network: http://${ip}:${PORT}`);
});
