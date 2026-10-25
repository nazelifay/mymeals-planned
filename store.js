// Data layer: Firebase (shared) when configured, otherwise this browser's localStorage (demo mode).
import { firebaseConfig } from './firebase-config.js';

export const isLocal = !firebaseConfig.apiKey || firebaseConfig.apiKey.startsWith('PASTE');

let fb = null;
let errorHandler = (e) => console.error(e);
export function onError(fn) { errorHandler = fn; }

export function newId() {
  try { return crypto.randomUUID(); } catch { return 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
}

/* ---------- local (demo) storage ---------- */
const subs = {};
function lread(k, d) {
  try { const v = JSON.parse(localStorage.getItem('mp:' + k)); return v ?? d; } catch { return d; }
}
function lwrite(k, v) {
  try { localStorage.setItem('mp:' + k, JSON.stringify(v)); } catch { /* storage unavailable */ }
  (subs[k] || []).forEach((cb) => cb(v));
}
function lsub(k, d, cb) {
  (subs[k] ||= []).push(cb);
  cb(lread(k, d));
  return () => { subs[k] = (subs[k] || []).filter((f) => f !== cb); };
}

/* ---------- auth ---------- */
export async function init(onUser) {
  if (isLocal) { onUser({ displayName: 'Demo mode', local: true }); return; }
  const V = '10.12.2';
  const [appM, authM, fsM] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`),
  ]);
  const app = appM.initializeApp(firebaseConfig);
  const auth = authM.getAuth(app);
  const db = fsM.getFirestore(app);
  fb = { authM, fsM, auth, db };
  authM.onAuthStateChanged(auth, (u) => onUser(u));
}

export function signIn() {
  const { authM, auth } = fb;
  return authM.signInWithPopup(auth, new authM.GoogleAuthProvider());
}
export function signOut() { if (fb) return fb.authM.signOut(fb.auth); }

/* ---------- recipes ---------- */
export function watchRecipes(cb) {
  const sorted = (arr) => arr.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  if (isLocal) return lsub('recipes', {}, (map) => cb(sorted(Object.values(map || {}))));
  const { fsM, db } = fb;
  return fsM.onSnapshot(fsM.collection(db, 'recipes'),
    (snap) => cb(sorted(snap.docs.map((d) => ({ ...d.data(), id: d.id })))),
    errorHandler);
}
export async function saveRecipe(r) {
  const id = r.id || newId();
  const data = { ...r, id };
  if (isLocal) { const map = lread('recipes', {}); map[id] = data; lwrite('recipes', map); return id; }
  const { fsM, db } = fb;
  await fsM.setDoc(fsM.doc(db, 'recipes', id), data).catch(errorHandler);
  return id;
}
export async function deleteRecipe(id) {
  if (isLocal) { const map = lread('recipes', {}); delete map[id]; lwrite('recipes', map); return; }
  const { fsM, db } = fb;
  await fsM.deleteDoc(fsM.doc(db, 'recipes', id)).catch(errorHandler);
}

/* ---------- weekly plans (one document per week, keyed by Monday's date) ---------- */
const emptyPlan = () => ({ days: {}, checked: {}, notes: {} });
const normPlan = (p) => ({ days: p?.days || {}, checked: p?.checked || {}, notes: p?.notes || {} });

export function watchPlan(weekId, cb) {
  if (isLocal) return lsub('plan:' + weekId, emptyPlan(), (p) => cb(normPlan(p)));
  const { fsM, db } = fb;
  return fsM.onSnapshot(fsM.doc(db, 'plans', weekId),
    (snap) => cb(normPlan(snap.exists() ? snap.data() : null)),
    errorHandler);
}
export async function getPlan(weekId) {
  if (isLocal) return normPlan(lread('plan:' + weekId, null));
  const { fsM, db } = fb;
  const snap = await fsM.getDoc(fsM.doc(db, 'plans', weekId));
  return normPlan(snap.exists() ? snap.data() : null);
}
export async function savePlan(weekId, plan) {
  if (isLocal) { lwrite('plan:' + weekId, plan); return; }
  const { fsM, db } = fb;
  await fsM.setDoc(fsM.doc(db, 'plans', weekId), plan).catch(errorHandler);
}

/* ---------- settings (pantry staples) ---------- */
export function watchSettings(cb) {
  const norm = (s) => ({ staples: s?.staples || [] });
  if (isLocal) return lsub('settings', {}, (s) => cb(norm(s)));
  const { fsM, db } = fb;
  return fsM.onSnapshot(fsM.doc(db, 'meta', 'settings'),
    (snap) => cb(norm(snap.exists() ? snap.data() : null)),
    errorHandler);
}
export async function saveSettings(s) {
  if (isLocal) { lwrite('settings', s); return; }
  const { fsM, db } = fb;
  await fsM.setDoc(fsM.doc(db, 'meta', 'settings'), s).catch(errorHandler);
}
