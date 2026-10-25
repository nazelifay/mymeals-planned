import * as store from './store.js';

/* ---------- constants ---------- */
const SLOTS = [
  { key: 'breakfast', label: 'Breakfast' },
  { key: 'snack1', label: 'Snack' },
  { key: 'lunch', label: 'Lunch' },
  { key: 'snack2', label: 'Snack' },
  { key: 'dinner', label: 'Dinner' },
];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const CATEGORIES = ['Breakfast', 'Main', 'Side', 'Salad', 'Soup', 'Snack', 'Dessert', 'Drink', 'Other'];
const UNITS = ['', 'g', 'kg', 'ml', 'l', 'tsp', 'tbsp', 'cup', 'piece', 'clove', 'slice', 'bunch', 'can', 'pack', 'pinch'];
const SECTIONS = ['Produce', 'Meat & fish', 'Dairy & eggs', 'Bakery', 'Pantry', 'Frozen', 'Spices', 'Other'];

/* ---------- state ---------- */
const state = {
  user: null,
  recipes: [],
  plan: { days: {}, checked: {} },
  settings: { staples: [] },
  weekStart: mondayOf(new Date()),
  view: 'plan',
  selected: null,      // recipe id picked for tap-to-place
  libFilter: '', libCat: '', recFilter: '',
  error: '',
};
let unsubPlan = null, unsubRecipes = null, unsubSettings = null;
const app = document.getElementById('app');

/* ---------- helpers ---------- */
function mondayOf(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function weekId(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const fmtDay = (d) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const recipeById = (id) => state.recipes.find((r) => r.id === id);
const clone = (o) => JSON.parse(JSON.stringify(o));
const cell = (plan, day, slot) => plan.days?.[day]?.[slot] || [];
const options = (list, selected) => list.map((v) => `<option value="${esc(v)}"${v === selected ? ' selected' : ''}>${esc(v || '—')}</option>`).join('');
function fmtNum(n) { return String(Math.round(n * 100) / 100); }

/* ---------- boot ---------- */
store.onError((e) => {
  console.error(e);
  state.error = String(e?.code || '').includes('permission')
    ? "This Google account isn't on the allowed list. Check the email addresses in your Firestore rules."
    : 'Something went wrong talking to the database: ' + (e?.message || e);
  renderError();
});

store.init((user) => {
  state.user = user;
  if (!user) { teardown(); renderSignIn(); return; }
  renderShell();
  unsubRecipes = store.watchRecipes((r) => { state.recipes = r; refresh(); });
  unsubSettings = store.watchSettings((s) => { state.settings = s; if (state.view === 'groceries') renderGroceries(); });
  watchWeek();
}).catch((e) => { app.innerHTML = `<div class="center-card"><h1>Couldn't start</h1><p>${esc(e.message)}</p></div>`; });

function teardown() {
  [unsubPlan, unsubRecipes, unsubSettings].forEach((u) => u && u());
  unsubPlan = unsubRecipes = unsubSettings = null;
}
function watchWeek() {
  if (unsubPlan) unsubPlan();
  state.plan = { days: {}, checked: {} };
  unsubPlan = store.watchPlan(weekId(state.weekStart), (p) => { state.plan = p; refresh(); });
}
function refresh() {
  if (state.view === 'plan') { renderLibrary(); renderGrid(); }
  if (state.view === 'recipes') renderRecipeList();
  if (state.view === 'groceries') renderGroceries();
}
function savePlan(plan) {
  state.plan = plan;
  refresh();
  store.savePlan(weekId(state.weekStart), plan);
}

/* ---------- screens ---------- */
function renderSignIn() {
  app.innerHTML = `
    <div class="center-card">
      <div class="logo">🍽️</div>
      <h1>Meal Planner</h1>
      <p>Sign in with your Google account to see your recipes and plans.</p>
      <button class="primary big" data-act="sign-in">Sign in with Google</button>
      <p class="error" id="error"></p>
    </div>`;
}
function renderError() {
  const el = document.getElementById('error');
  if (el) { el.textContent = state.error; el.hidden = !state.error; }
}

function renderShell() {
  app.innerHTML = `
    <header class="topbar">
      <div class="brand">🍽️ <span>Meal Planner</span></div>
      <nav class="tabs">
        <button data-view="plan">Week plan</button>
        <button data-view="recipes">Recipes</button>
        <button data-view="groceries">Groceries</button>
      </nav>
      <div class="who">
        <span>${esc(state.user.displayName || state.user.email || '')}</span>
        ${state.user.local ? '' : '<button class="link" data-act="sign-out">Sign out</button>'}
      </div>
    </header>
    ${store.isLocal ? '<div class="banner">Demo mode: everything is saved only in this browser. Paste your Firebase config into <code>firebase-config.js</code> to share it.</div>' : ''}
    <p class="error banner-error" id="error" hidden></p>
    <main id="main"></main>`;
  renderView();
  renderError();
}

function renderView() {
  app.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === state.view));
  const main = document.getElementById('main');
  if (state.view === 'plan') {
    main.innerHTML = `
      <div class="plan-layout">
        <aside class="library">
          <h3>Recipes</h3>
          <input id="lib-search" type="search" placeholder="Search…" value="${esc(state.libFilter)}">
          <select id="lib-cat"><option value="">All categories</option>${options(CATEGORIES, state.libCat)}</select>
          <div id="lib-list" class="lib-list"></div>
          <p class="hint">Drag a recipe onto the calendar, or tap a recipe and then tap a slot.</p>
        </aside>
        <section class="week">
          <div class="week-nav">
            <button data-act="prev-week" aria-label="Previous week">‹</button>
            <h2 id="week-title"></h2>
            <button data-act="next-week" aria-label="Next week">›</button>
            <span class="spacer"></span>
            <button data-act="this-week">This week</button>
            <button data-act="copy-prev">Copy last week</button>
            <button data-act="clear-week">Clear week</button>
          </div>
          <div class="grid-scroll"><div id="grid" class="grid"></div></div>
        </section>
      </div>`;
    renderLibrary(); renderGrid();
  } else if (state.view === 'recipes') {
    main.innerHTML = `
      <div class="recipes-page">
        <div class="recipes-head">
          <input id="rec-search" type="search" placeholder="Search recipes or ingredients…" value="${esc(state.recFilter)}">
          <button class="primary" data-act="new-recipe">+ New recipe</button>
        </div>
        <div id="recipe-form-wrap"></div>
        <div id="recipe-list" class="recipe-list"></div>
      </div>`;
    renderRecipeList();
  } else {
    main.innerHTML = `<div id="groceries" class="groceries-page"></div>`;
    renderGroceries();
  }
}

/* ---------- plan view ---------- */
function renderLibrary() {
  const el = document.getElementById('lib-list');
  if (!el) return;
  const q = state.libFilter.trim().toLowerCase();
  const list = state.recipes.filter((r) =>
    (!state.libCat || r.category === state.libCat) && (!q || (r.name || '').toLowerCase().includes(q)));
  if (!state.recipes.length) {
    el.innerHTML = `<p class="muted">No recipes yet. <button class="link" data-view="recipes">Add your first one →</button></p>`;
    return;
  }
  el.innerHTML = list.map((r) => `
    <div class="chip cat-${esc((r.category || 'Other').toLowerCase())}${state.selected === r.id ? ' selected' : ''}"
         draggable="true" data-drag="recipe" data-rid="${esc(r.id)}" title="${esc(r.category || '')}">
      ${esc(r.name)}
    </div>`).join('') || '<p class="muted">No matches.</p>';
  document.body.classList.toggle('placing', !!state.selected);
}

function renderGrid() {
  const grid = document.getElementById('grid');
  if (!grid) return;
  const end = addDays(state.weekStart, 6);
  document.getElementById('week-title').textContent = `${fmtDay(state.weekStart)} – ${fmtDay(end)}`;
  const today = weekId(new Date());
  let html = '<div class="corner"></div>';
  DAYS.forEach((d, i) => {
    const date = addDays(state.weekStart, i);
    html += `<div class="day-head${weekId(date) === today ? ' today' : ''}">${d}<small>${fmtDay(date)}</small></div>`;
  });
  SLOTS.forEach((s) => {
    html += `<div class="slot-head">${s.label}</div>`;
    DAYS.forEach((_, day) => {
      const entries = cell(state.plan, day, s.key);
      html += `<div class="cell" data-day="${day}" data-slot="${s.key}">` +
        entries.map((e, idx) => {
          const r = recipeById(e.rid);
          return `<div class="entry cat-${esc((r?.category || 'other').toLowerCase())}" draggable="true" data-drag="entry" data-day="${day}" data-slot="${s.key}" data-idx="${idx}">
            <span>${r ? esc(r.name) : '<em>deleted recipe</em>'}</span>
            <button class="x" data-act="remove-entry" data-day="${day}" data-slot="${s.key}" data-idx="${idx}" aria-label="Remove">×</button>
          </div>`;
        }).join('') + '</div>';
    });
  });
  grid.innerHTML = html;
}

function addEntry(day, slot, rid) {
  const p = clone(state.plan);
  p.days[day] ||= {};
  (p.days[day][slot] ||= []).push({ rid });
  savePlan(p);
}
function removeEntry(day, slot, idx) {
  const p = clone(state.plan);
  p.days[day]?.[slot]?.splice(idx, 1);
  savePlan(p);
}
function moveEntry(from, to) {
  if (from.day === to.day && from.slot === to.slot) return;
  const p = clone(state.plan);
  const [e] = p.days[from.day]?.[from.slot]?.splice(from.idx, 1) || [];
  if (!e) return;
  p.days[to.day] ||= {};
  (p.days[to.day][to.slot] ||= []).push(e);
  savePlan(p);
}
const planIsEmpty = (p) => Object.values(p.days || {}).every((d) => Object.values(d || {}).every((a) => !a?.length));

/* ---------- recipes view ---------- */
function renderRecipeList() {
  const el = document.getElementById('recipe-list');
  if (!el) return;
  const q = state.recFilter.trim().toLowerCase();
  const list = state.recipes.filter((r) => !q || (r.name || '').toLowerCase().includes(q) ||
    (r.ingredients || []).some((i) => (i.name || '').toLowerCase().includes(q)));
  if (!state.recipes.length) {
    el.innerHTML = `<div class="empty"><p>Your recipe library is empty.</p><p class="muted">Add single items like “Mashed potatoes”, “Baked salmon” or “Cucumber yogurt”. You combine them into meals on the week plan.</p></div>`;
    return;
  }
  el.innerHTML = list.map((r) => `
    <article class="recipe-card">
      <div class="rc-top">
        <h3>${esc(r.name)}</h3>
        <span class="tag cat-${esc((r.category || 'other').toLowerCase())}">${esc(r.category || 'Other')}</span>
      </div>
      <p class="muted">${r.servings ? `Makes ${esc(r.servings)} serving${r.servings == 1 ? '' : 's'} · ` : ''}${(r.ingredients || []).length} ingredient${(r.ingredients || []).length === 1 ? '' : 's'}</p>
      <p class="ing-summary">${(r.ingredients || []).map((i) => esc([i.amount, i.unit, i.name].filter(Boolean).join(' '))).join(', ')}</p>
      ${r.notes ? `<p class="notes">${esc(r.notes)}</p>` : ''}
      <div class="rc-actions">
        <button data-act="edit-recipe" data-rid="${esc(r.id)}">Edit</button>
        <button class="danger-link" data-act="delete-recipe" data-rid="${esc(r.id)}">Delete</button>
      </div>
    </article>`).join('') || '<p class="muted">No matches.</p>';
}

function allIngredientNames() {
  const s = new Set();
  state.recipes.forEach((r) => (r.ingredients || []).forEach((i) => i.name && s.add(i.name.trim())));
  return [...s].sort((a, b) => a.localeCompare(b));
}
function ingRow(i = {}) {
  return `<div class="ing-row">
    <input class="i-amount" type="number" step="any" min="0" placeholder="Amt" value="${esc(i.amount ?? '')}">
    <select class="i-unit">${options(UNITS, i.unit || '')}</select>
    <input class="i-name" list="ing-names" placeholder="Ingredient" value="${esc(i.name || '')}">
    <select class="i-section">${options(SECTIONS, i.section || 'Other')}</select>
    <button type="button" class="x" data-act="remove-ing" aria-label="Remove ingredient">×</button>
  </div>`;
}
function openRecipeForm(r = null) {
  const wrap = document.getElementById('recipe-form-wrap');
  const data = r || { name: '', category: 'Main', servings: 2, ingredients: [{}, {}, {}], notes: '' };
  wrap.innerHTML = `
    <form id="recipe-form" class="recipe-form" data-rid="${esc(r?.id || '')}">
      <h2>${r ? 'Edit recipe' : 'New recipe'}</h2>
      <div class="form-row">
        <label class="grow">Name<input name="name" required value="${esc(data.name)}" placeholder="e.g. Mashed potatoes"></label>
        <label>Category<select name="category">${options(CATEGORIES, data.category)}</select></label>
        <label class="narrow">Servings<input name="servings" type="number" min="1" step="1" value="${esc(data.servings ?? '')}"></label>
      </div>
      <div class="ing-head"><span>Ingredients</span><small class="muted">Use the same ingredient names across recipes so the grocery list can add them up.</small></div>
      <div id="ing-rows">${(data.ingredients?.length ? data.ingredients : [{}]).map(ingRow).join('')}</div>
      <button type="button" class="link" data-act="add-ing">+ Add ingredient</button>
      <datalist id="ing-names">${allIngredientNames().map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
      <label>Notes / steps<textarea name="notes" rows="3" placeholder="Optional">${esc(data.notes || '')}</textarea></label>
      <div class="form-actions">
        <button type="submit" class="primary">Save recipe</button>
        <button type="button" data-act="cancel-recipe">Cancel</button>
      </div>
    </form>`;
  wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
  wrap.querySelector('input[name=name]').focus();
}
async function submitRecipe(form) {
  const fd = new FormData(form);
  const name = String(fd.get('name') || '').trim();
  if (!name) return;
  const ingredients = [...form.querySelectorAll('.ing-row')].map((row) => ({
    amount: row.querySelector('.i-amount').value,
    unit: row.querySelector('.i-unit').value,
    name: row.querySelector('.i-name').value.trim(),
    section: row.querySelector('.i-section').value,
  })).filter((i) => i.name);
  const recipe = {
    name,
    category: fd.get('category'),
    servings: Number(fd.get('servings')) || null,
    ingredients,
    notes: String(fd.get('notes') || '').trim(),
  };
  if (form.dataset.rid) recipe.id = form.dataset.rid;
  await store.saveRecipe(recipe);
  document.getElementById('recipe-form-wrap').innerHTML = '';
}

/* ---------- groceries view ---------- */
function buildGroceries() {
  const totals = new Map();
  for (let day = 0; day < 7; day++) {
    for (const s of SLOTS) {
      for (const e of cell(state.plan, day, s.key)) {
        const r = recipeById(e.rid);
        if (!r) continue;
        for (const ing of r.ingredients || []) {
          const name = (ing.name || '').trim();
          if (!name) continue;
          let amt = parseFloat(ing.amount);
          let unit = ing.unit || '';
          if (unit === 'kg') { amt *= 1000; unit = 'g'; }
          if (unit === 'l') { amt *= 1000; unit = 'ml'; }
          const key = name.toLowerCase() + '|' + unit;
          const cur = totals.get(key) || { key, name, unit, amount: 0, hasAmount: false, section: ing.section || 'Other', recipes: new Set() };
          if (!isNaN(amt)) { cur.amount += amt; cur.hasAmount = true; }
          cur.recipes.add(r.name);
          totals.set(key, cur);
        }
      }
    }
  }
  const staples = new Set(state.settings.staples.map((s) => s.toLowerCase()));
  const items = [...totals.values()];
  return {
    toBuy: items.filter((i) => !staples.has(i.name.toLowerCase())),
    staples: items.filter((i) => staples.has(i.name.toLowerCase())),
  };
}
function qty(i) {
  if (!i.hasAmount) return i.unit || '';
  let a = i.amount, u = i.unit;
  if (u === 'g' && a >= 1000) { a /= 1000; u = 'kg'; }
  if (u === 'ml' && a >= 1000) { a /= 1000; u = 'l'; }
  return `${fmtNum(a)} ${u}`.trim();
}
function itemHtml(i) {
  const checked = !!state.plan.checked?.[i.key];
  return `<label class="g-item${checked ? ' done' : ''}">
    <input type="checkbox" data-gkey="${esc(i.key)}"${checked ? ' checked' : ''}>
    <span class="g-name">${esc(i.name)}</span>
    <span class="g-qty">${esc(qty(i))}</span>
    <small class="g-for">${esc([...i.recipes].join(', '))}</small>
  </label>`;
}
function renderGroceries() {
  const el = document.getElementById('groceries');
  if (!el) return;
  const { toBuy, staples } = buildGroceries();
  const bySection = SECTIONS.map((sec) => [sec, toBuy.filter((i) => i.section === sec).sort((a, b) => a.name.localeCompare(b.name))])
    .filter(([, list]) => list.length);
  el.innerHTML = `
    <div class="week-nav">
      <button data-act="prev-week" aria-label="Previous week">‹</button>
      <h2>Groceries · ${fmtDay(state.weekStart)} – ${fmtDay(addDays(state.weekStart, 6))}</h2>
      <button data-act="next-week" aria-label="Next week">›</button>
      <span class="spacer"></span>
      <button data-act="copy-list">Copy list</button>
    </div>
    ${!toBuy.length && !staples.length ? '<div class="empty"><p>Nothing to buy yet.</p><p class="muted">Plan some meals for this week and the list builds itself.</p></div>' : ''}
    <div class="g-sections">
      ${bySection.map(([sec, list]) => `<section class="g-section"><h3>${esc(sec)}</h3>${list.map(itemHtml).join('')}</section>`).join('')}
    </div>
    ${staples.length ? `<section class="g-section staples"><h3>Pantry staples: check you have these</h3>${staples.map(itemHtml).join('')}</section>` : ''}
    <details class="staples-edit">
      <summary>Edit pantry staples</summary>
      <p class="muted">Ingredients you always keep at home (salt, olive oil…). They're listed separately so they don't clutter the shopping list. One per line.</p>
      <textarea id="staples-input" rows="5">${esc(state.settings.staples.join('\n'))}</textarea>
      <button class="primary" data-act="save-staples">Save staples</button>
    </details>`;
}

/* ---------- events ---------- */
app.addEventListener('click', async (e) => {
  const viewBtn = e.target.closest('[data-view]');
  if (viewBtn) { state.view = viewBtn.dataset.view; state.selected = null; document.body.classList.remove('placing'); renderView(); return; }

  const act = e.target.closest('[data-act]');
  if (act) {
    const a = act.dataset.act;
    if (a === 'sign-in') { store.signIn().catch((err) => { state.error = err.message; renderError(); }); }
    else if (a === 'sign-out') store.signOut();
    else if (a === 'prev-week' || a === 'next-week' || a === 'this-week') {
      state.weekStart = a === 'this-week' ? mondayOf(new Date()) : addDays(state.weekStart, a === 'prev-week' ? -7 : 7);
      watchWeek();
    }
    else if (a === 'remove-entry') { e.stopPropagation(); removeEntry(+act.dataset.day, act.dataset.slot, +act.dataset.idx); }
    else if (a === 'clear-week') { if (!planIsEmpty(state.plan) && confirm('Clear every meal from this week?')) savePlan({ days: {}, checked: {} }); }
    else if (a === 'copy-prev') {
      const prev = await store.getPlan(weekId(addDays(state.weekStart, -7)));
      if (planIsEmpty(prev)) { alert('Last week has no meals to copy.'); return; }
      if (!planIsEmpty(state.plan) && !confirm('Replace this week with last week’s plan?')) return;
      savePlan({ days: prev.days, checked: {} });
    }
    else if (a === 'new-recipe') openRecipeForm();
    else if (a === 'edit-recipe') openRecipeForm(recipeById(act.dataset.rid));
    else if (a === 'delete-recipe') { const r = recipeById(act.dataset.rid); if (r && confirm(`Delete “${r.name}”?`)) store.deleteRecipe(r.id); }
    else if (a === 'cancel-recipe') document.getElementById('recipe-form-wrap').innerHTML = '';
    else if (a === 'add-ing') { document.getElementById('ing-rows').insertAdjacentHTML('beforeend', ingRow()); document.querySelector('#ing-rows .ing-row:last-child .i-amount').focus(); }
    else if (a === 'remove-ing') act.closest('.ing-row').remove();
    else if (a === 'save-staples') {
      const staples = document.getElementById('staples-input').value.split(/\n|,/).map((s) => s.trim()).filter(Boolean);
      store.saveSettings({ ...state.settings, staples });
    }
    else if (a === 'copy-list') {
      const { toBuy } = buildGroceries();
      const text = SECTIONS.map((sec) => {
        const list = toBuy.filter((i) => i.section === sec && !state.plan.checked?.[i.key]);
        return list.length ? `${sec}\n${list.map((i) => `- ${i.name}${qty(i) ? ' (' + qty(i) + ')' : ''}`).join('\n')}` : '';
      }).filter(Boolean).join('\n\n');
      try { await navigator.clipboard.writeText(text); act.textContent = 'Copied!'; setTimeout(() => (act.textContent = 'Copy list'), 1500); }
      catch { prompt('Copy your list:', text); }
    }
    return;
  }

  // tap-to-place
  const chip = e.target.closest('.chip[data-rid]');
  if (chip) { state.selected = state.selected === chip.dataset.rid ? null : chip.dataset.rid; renderLibrary(); return; }
  const c = e.target.closest('.cell');
  if (c && state.selected) addEntry(+c.dataset.day, c.dataset.slot, state.selected);
});

app.addEventListener('input', (e) => {
  if (e.target.id === 'lib-search') { state.libFilter = e.target.value; renderLibrary(); }
  if (e.target.id === 'rec-search') { state.recFilter = e.target.value; renderRecipeList(); }
});
app.addEventListener('change', (e) => {
  if (e.target.id === 'lib-cat') { state.libCat = e.target.value; renderLibrary(); }
  if (e.target.matches('[data-gkey]')) {
    const p = clone(state.plan);
    p.checked ||= {};
    if (e.target.checked) p.checked[e.target.dataset.gkey] = true; else delete p.checked[e.target.dataset.gkey];
    savePlan(p);
  }
  // Fill unit/section from earlier recipes when an existing ingredient name is chosen
  if (e.target.matches('.i-name')) {
    const row = e.target.closest('.ing-row');
    const name = e.target.value.trim().toLowerCase();
    for (const r of state.recipes) {
      const hit = (r.ingredients || []).find((i) => (i.name || '').trim().toLowerCase() === name);
      if (hit) {
        if (!row.querySelector('.i-unit').value) row.querySelector('.i-unit').value = hit.unit || '';
        if (row.querySelector('.i-section').value === 'Other') row.querySelector('.i-section').value = hit.section || 'Other';
        break;
      }
    }
  }
});
app.addEventListener('submit', (e) => {
  if (e.target.id === 'recipe-form') { e.preventDefault(); submitRecipe(e.target); }
});

/* drag and drop */
app.addEventListener('dragstart', (e) => {
  const el = e.target.closest('[data-drag]');
  if (!el) return;
  const payload = el.dataset.drag === 'recipe'
    ? { type: 'recipe', rid: el.dataset.rid }
    : { type: 'entry', day: +el.dataset.day, slot: el.dataset.slot, idx: +el.dataset.idx };
  e.dataTransfer.setData('text/plain', JSON.stringify(payload));
  e.dataTransfer.effectAllowed = 'copyMove';
  el.classList.add('dragging');
});
app.addEventListener('dragend', (e) => { e.target.closest?.('[data-drag]')?.classList.remove('dragging'); });
app.addEventListener('dragover', (e) => {
  const c = e.target.closest('.cell');
  if (!c) return;
  e.preventDefault();
  app.querySelectorAll('.cell.over').forEach((x) => x !== c && x.classList.remove('over'));
  c.classList.add('over');
});
app.addEventListener('dragleave', (e) => {
  const c = e.target.closest('.cell');
  if (c && !c.contains(e.relatedTarget)) c.classList.remove('over');
});
app.addEventListener('drop', (e) => {
  const c = e.target.closest('.cell');
  if (!c) return;
  e.preventDefault();
  c.classList.remove('over');
  let p;
  try { p = JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return; }
  const to = { day: +c.dataset.day, slot: c.dataset.slot };
  if (p.type === 'recipe') addEntry(to.day, to.slot, p.rid);
  else if (p.type === 'entry') moveEntry(p, to);
});
