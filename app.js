(() => {
'use strict';

const cfg = window.APP_CONFIG || {};
const root = document.getElementById('root');
const dlg = document.getElementById('dlg');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const inr = n => new Intl.NumberFormat('en-IN', {style:'currency', currency:'INR', maximumFractionDigits:2}).format(Number(n) || 0);
const num2 = n => (Number(n) || 0).toLocaleString('en-IN', {minimumFractionDigits:2, maximumFractionDigits:2});
const dmy = s => { if (!s) return ''; const [y,m,d] = String(s).split('-'); return d ? `${d}-${m}-${y}` : s; };
const today = () => new Date().toLocaleDateString('en-CA');
const CATS = ['Site material','Hardware','Consultant fees','Printing & plotting','Approvals & liaison','Travel & site visit','Models & samples','Furniture & fixtures','Other'];
const STATUSES = ['Unpaid','Partial','Paid'];
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const gstOf = e => r2(Number(e.amount || 0) * Number(e.gst_percent || 0) / 100);
const totalOf = e => r2(Number(e.amount || 0) + gstOf(e));
const paidOf = e => e.payment_status === 'Paid' ? totalOf(e) : e.payment_status === 'Partial' ? Number(e.paid_amount || 0) : 0;
const balOf = e => Math.max(0, r2(totalOf(e) - paidOf(e)));

const S = { user:null, role:'none', projects:[], pid:null, sheets:[], sid:null, entries:[], urls:{}, q:'' };
let sb = null;
let bootedId = undefined;

// ---------- small helpers ----------
function toast(msg, isErr) {
  const t = document.createElement('div');
  t.className = 'toast' + (isErr ? ' err' : '');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), isErr ? 5000 : 2500);
}
const isAdmin = () => S.role === 'admin';
const curProject = () => S.projects.find(p => p.id === S.pid);
const curSheet = () => S.sheets.find(s => s.id === S.sid);
function openDlg(html) { dlg.innerHTML = html; if (!dlg.open) dlg.showModal(); }
function closeDlg() { if (dlg.open) dlg.close(); }

async function compress(file, max = 1600, q = 0.8) {
  try {
    const bmp = await createImageBitmap(file);
    const r = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * r); c.height = Math.round(bmp.height * r);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise(res => c.toBlob(b => res(b || file), 'image/jpeg', q));
  } catch { return file; }
}

// ---------- boot ----------
function init() {
  document.title = 'HNJ Architects - Project Expenses';
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
    root.innerHTML = `<div class="card center"><h2>Setup needed</h2><p>Open <code>config.js</code> and paste your Supabase URL and anon key. See README.md.</p></div>`;
    return;
  }
  sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  sb.auth.onAuthStateChange((_ev, session) => { setTimeout(() => boot(session), 0); });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

async function boot(session) {
  const uid = session?.user?.id || null;
  if (uid === bootedId) return;
  bootedId = uid;
  if (!uid) { S.user = null; S.role = 'none'; S.projects = []; S.pid = null; renderLogin(); return; }
  S.user = session.user;
  root.innerHTML = '<div class="card center">Loading…</div>';
  const { data, error } = await sb.rpc('my_role');
  S.role = error ? 'none' : data;
  if (S.role === 'none') { renderNoAccess(); return; }
  await loadProjects();
}

async function loadProjects() {
  const { data, error } = await sb.from('projects').select('*').order('created_at');
  if (error) { toast(error.message, true); return; }
  S.projects = data;
  if (!S.projects.find(p => p.id === S.pid)) S.pid = S.projects[0]?.id || null;
  if (S.pid) await loadProject(S.pid); else { S.sheets = []; S.entries = []; renderApp(); }
}

async function loadProject(pid) {
  S.pid = pid;
  const [sh, en] = await Promise.all([
    sb.from('sheets').select('*').eq('project_id', pid).order('created_at'),
    sb.from('entries').select('*').eq('project_id', pid).order('entry_date', {nullsFirst:true}).order('created_at')
  ]);
  if (sh.error || en.error) { toast((sh.error || en.error).message, true); return; }
  S.sheets = sh.data; S.entries = en.data;
  if (!S.sheets.find(s => s.id === S.sid)) S.sid = S.sheets[0]?.id || null;
  await signPhotos();
  renderApp();
}

async function signPhotos() {
  S.urls = {};
  const paths = [...new Set(S.entries.map(e => e.photo_path).filter(Boolean))];
  if (!paths.length) return;
  const { data } = await sb.storage.from('bills').createSignedUrls(paths, 3600);
  (data || []).forEach(d => { if (d.signedUrl) S.urls[d.path] = d.signedUrl; });
}

// ---------- login ----------
function renderLogin() {
  root.innerHTML = `
  <div class="card center">
    <h2 style="margin-bottom:0">HNJ Architects</h2>
    <p style="margin:2px 0 10px;font-weight:600;color:var(--brand)">Project Expenses</p>
    <p class="muted">Sign in to view or manage your project bills.</p>
    <button class="btn primary" style="width:100%" data-act="google">Continue with Google</button>
    <div class="divider">or use email &amp; password</div>
    <form id="loginForm">
      <input type="email" name="email" placeholder="Email" required autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false">
      <div style="height:8px"></div>
      <input type="password" name="password" placeholder="Password (min 6 characters)" required minlength="6" autocomplete="current-password" autocapitalize="none" autocorrect="off" spellcheck="false">
      <label style="display:flex;gap:8px;align-items:center;margin:8px 0 0"><input type="checkbox" id="showpw" style="width:auto"> Show password</label>
      <div class="row" style="margin-top:10px">
        <button class="btn primary grow" type="submit">Sign in</button>
        <button class="btn grow" type="button" data-act="signup">Create account</button>
      </div>
    </form>
    <p class="hint">Clients: sign in with the email address HNJ Architects registered for you.</p>
  </div>`;
}

function renderNoAccess() {
  root.innerHTML = `
  <div class="card center">
    <h2>No access yet</h2>
    <p>You're signed in as <b>${esc(S.user.email)}</b>, but this email isn't linked to any project.</p>
    <p class="muted">Ask HNJ Architects to add this exact email address to your project.</p>
    <button class="btn" data-act="logout">Sign out</button>
  </div>`;
}

// ---------- main screen ----------
function renderApp() {
  const A = isAdmin();
  const p = curProject();
  root.innerHTML = `
  <header class="top">
    <span class="ttl"><b>HNJ Architects</b><small>Project Expenses</small></span>
    <span class="who">${esc(S.user.email)} · ${A ? 'Admin' : 'Client'} · <a href="#" data-act="logout" style="color:inherit">Sign out</a></span>
  </header>
  <div class="wrap">
    ${S.projects.length ? `
    <div class="row">
      <select id="projSel" class="grow" style="max-width:340px">
        ${S.projects.map(x => `<option value="${x.id}" ${x.id === S.pid ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}
      </select>
      ${A ? `
        <button class="btn small" data-act="newProject">+ Project</button>
        <button class="btn small" data-act="renameProject">Rename</button>
        <button class="btn small" data-act="clients">Clients</button>
        <button class="btn small" data-act="admins">Admins</button>
        <button class="btn small" data-act="backup">Backup</button>
        <button class="btn small danger" data-act="delProject">Delete</button>` : ''}
    </div>` : `
    <div class="card">
      <h3>${A ? 'No projects yet' : 'No project assigned'}</h3>
      ${A ? `<button class="btn primary" data-act="newProject">+ Create your first project</button>
            <button class="btn" data-act="admins">Admins</button>` : ''}
    </div>`}
    ${p ? `
    <div class="tabs" id="tabs">
      ${S.sheets.map(s => `<button class="tab ${s.id === S.sid ? 'on' : ''}" data-act="tab" data-id="${s.id}">${esc(s.name)}</button>`).join('')}
      ${A ? `<button class="tab" data-act="newSheet">+ Sheet</button>` : ''}
    </div>
    ${curSheet() ? `
    <div class="row">
      <input type="text" id="q" class="grow" style="max-width:320px" placeholder="Search vendor, item, category…" value="${esc(S.q)}">
      ${A ? `<button class="btn primary" data-act="addEntry">+ Add entry</button>
             <button class="btn small" data-act="renameSheet">Rename sheet</button>
             <button class="btn small danger" data-act="delSheet">Delete sheet</button>` : ''}
      <button class="btn" data-act="pdf">Export PDF</button>
      <button class="btn" data-act="csv">Export CSV</button>
    </div>
    <div id="chips" class="chips"></div>
    <div id="tbl" class="tablewrap"></div>` : `
    <div class="card" style="margin-top:10px">${A ? 'This project has no sheets yet. Tap “+ Sheet” to create one.' : 'Nothing has been added to this project yet.'}</div>`}
    ` : ''}
  </div>`;
  if (curSheet()) renderTable();
}

function sheetEntries() {
  const q = S.q.trim().toLowerCase();
  return S.entries.filter(e => e.sheet_id === S.sid).filter(e =>
    !q || [e.vendor, e.description, e.category, e.remarks, e.client_remarks, e.payment_status].some(v => String(v || '').toLowerCase().includes(q)));
}

function renderTable() {
  const A = isAdmin();
  const all = S.entries.filter(e => e.sheet_id === S.sid);
  const tot = all.reduce((x, e) => x + totalOf(e), 0);
  const gst = all.reduce((x, e) => x + gstOf(e), 0);
  const paid = all.reduce((x, e) => x + paidOf(e), 0);
  $('#chips').innerHTML = `
    <div class="chip">Total billed (incl. GST)<b>${inr(tot)}</b></div>
    <div class="chip">GST included<b>${inr(gst)}</b></div>
    <div class="chip">Paid<b style="color:var(--paid)">${inr(paid)}</b></div>
    <div class="chip">Balance due<b style="color:var(--unpaid)">${inr(tot - paid)}</b></div>
    <div class="chip">Entries<b>${all.length}</b></div>`;
  const rows = sheetEntries();
  $('#tbl').innerHTML = `
  <table>
    <thead><tr>
      <th>#</th><th>Date</th><th>Vendor</th><th>Description</th><th>Category</th>
      <th class="num">Amount</th><th class="num">GST</th><th class="num">Total incl. GST</th><th class="num">Paid</th><th class="num">Balance</th><th>Status</th><th>Photo</th><th>Remarks</th><th>Client remarks</th>${A ? '<th></th>' : ''}
    </tr></thead>
    <tbody>
    ${rows.length ? rows.map((e, i) => `
      <tr>
        <td class="muted">${i + 1}</td>
        <td style="white-space:nowrap">${esc(dmy(e.entry_date))}</td>
        <td>${esc(e.vendor)}</td>
        <td>${esc(e.description)}</td>
        <td>${esc(e.category)}</td>
        <td class="num">${inr(e.amount)}</td>
        <td class="num">${Number(e.gst_percent) > 0 ? `${esc(Number(e.gst_percent))}%<br><span class="muted">${inr(gstOf(e))}</span>` : '<span class="muted">—</span>'}</td>
        <td class="num"><b>${inr(totalOf(e))}</b></td>
        <td class="num" style="color:var(--paid)">${inr(paidOf(e))}</td>
        <td class="num" style="${balOf(e) > 0 ? 'color:var(--unpaid);font-weight:600' : 'color:var(--muted)'}">${inr(balOf(e))}</td>
        <td><span class="st ${esc(e.payment_status)}">${esc(e.payment_status)}</span></td>
        <td>${e.photo_path && S.urls[e.photo_path]
              ? `<img class="thumb" src="${esc(S.urls[e.photo_path])}" alt="Bill" data-act="photo" data-id="${e.id}">`
              : '<span class="muted">—</span>'}</td>
        <td>${esc(e.remarks)}</td>
        <td class="remark">
          ${A ? esc(e.client_remarks) || '<span class="muted">—</span>' : `
            <textarea rows="2" id="cr-${e.id}" maxlength="2000" placeholder="Write a comment…">${esc(e.client_remarks)}</textarea>
            <button class="btn small" data-act="saveRemark" data-id="${e.id}" style="margin-top:4px">Save comment</button>`}
        </td>
        ${A ? `<td style="white-space:nowrap">
          <button class="btn small" data-act="editEntry" data-id="${e.id}">Edit</button>
          <button class="btn small danger" data-act="delEntry" data-id="${e.id}">✕</button></td>` : ''}
      </tr>`).join('') : `<tr><td colspan="${A ? 15 : 14}" class="muted" style="text-align:center;padding:22px">No entries${S.q ? ' match your search' : ' yet'}.</td></tr>`}
    </tbody>
  </table>`;
}
function $(s, r = document) { return r.querySelector(s); }

// ---------- entry form (admin) ----------
let pendingPhoto = null, removePhoto = false, editingId = null;

function entryForm(e) {
  editingId = e?.id || null; pendingPhoto = null; removePhoto = false;
  const st0 = e?.payment_status || 'Unpaid';
  const cur = e?.photo_path && S.urls[e.photo_path];
  openDlg(`
  <form id="entryForm" method="dialog">
    <h3>${e ? 'Edit entry' : 'New entry'} <span class="muted" style="font-size:13px">· ${esc(curSheet().name)}</span></h3>
    <div class="grid2">
      <div><label>Date</label><input type="date" name="entry_date" value="${esc(e?.entry_date || today())}" required></div>
      <div><label>Amount before GST (₹)</label><input type="number" name="amount" step="0.01" min="0" inputmode="decimal" value="${esc(e?.amount ?? '')}" required></div>
    </div>
    <div class="grid2">
      <div><label>GST %</label><input type="number" name="gst_percent" step="0.01" min="0" max="100" inputmode="decimal" list="gstopts" value="${esc(e?.gst_percent ?? 0)}"><datalist id="gstopts"><option value="0"><option value="5"><option value="12"><option value="18"><option value="28"></datalist></div>
      <div><label>Total incl. GST</label><div id="totBox" style="padding:9px 10px;border:1px solid var(--line);border-radius:9px;background:var(--bg);font-weight:700;min-height:38px"></div></div>
    </div>
    <div class="hint" id="gstHint" style="font-weight:600"></div>
    <label>Vendor</label><input type="text" name="vendor" value="${esc(e?.vendor)}" placeholder="Shop / supplier name">
    <label>Description</label><input type="text" name="description" value="${esc(e?.description)}" placeholder="What was purchased">
    <div class="grid2">
      <div><label>Category</label><input type="text" name="category" list="cats" value="${esc(e?.category)}"><datalist id="cats">${CATS.map(c => `<option value="${c}">`).join('')}</datalist></div>
      <div><label>Payment status</label><select name="payment_status">${STATUSES.map(s => `<option ${((e?.payment_status) || 'Unpaid') === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
    </div>
    <div id="paidWrap" style="display:${st0 === 'Partial' ? 'block' : 'none'}">
      <label>Amount paid so far, incl. GST (₹)</label>
      <input type="number" name="paid_amount" step="0.01" min="0" inputmode="decimal" value="${esc(e?.paid_amount || '')}" placeholder="e.g. 40000">
      <div class="hint" id="balHint" style="font-weight:600"></div>
    </div>
    <label>Photo of bill</label>
    <div class="row">
      <button class="btn" type="button" data-act="pickCam">📷 Take photo</button>
      <button class="btn" type="button" data-act="pickGal">🖼 Choose from gallery</button>
      ${cur ? `<button class="btn danger small" type="button" data-act="rmPhoto">Remove photo</button>` : ''}
    </div>
    <input type="file" id="fCam" accept="image/*" capture="environment" hidden>
    <input type="file" id="fGal" accept="image/*" hidden>
    <div id="prev">${cur ? `<img class="preview" src="${esc(cur)}" alt="Bill">` : ''}</div>
    <label>Remarks (internal / visible to client)</label><textarea name="remarks" rows="2">${esc(e?.remarks)}</textarea>
    <div class="row" style="margin-top:14px;justify-content:flex-end">
      <button class="btn" type="button" data-act="closeDlg">Cancel</button>
      <button class="btn primary" type="submit" id="saveBtn">Save</button>
    </div>
  </form>`);
  const onFile = ev => {
    const f = ev.target.files[0]; if (!f) return;
    pendingPhoto = f; removePhoto = false;
    $('#prev').innerHTML = `<img class="preview" src="${URL.createObjectURL(f)}" alt="New bill">`;
  };
  const sync = () => {
    const f = $('#entryForm'), s = f.payment_status.value;
    const base = parseFloat(f.amount.value) || 0, pct = parseFloat(f.gst_percent.value) || 0;
    const gst = r2(base * pct / 100), tot = r2(base + gst);
    $('#totBox').textContent = inr(tot);
    $('#gstHint').textContent = pct > 0 ? `GST ${pct}% = ${inr(gst)}` : '';
    $('#paidWrap').style.display = s === 'Partial' ? 'block' : 'none';
    const pd = parseFloat(f.paid_amount.value) || 0;
    $('#balHint').textContent = s === 'Partial' ? `Balance remaining: ${inr(Math.max(0, r2(tot - pd)))}` : '';
  };
  ['payment_status', 'amount', 'gst_percent', 'paid_amount'].forEach(n => { const el = $('#entryForm').elements[n]; el.addEventListener('input', sync); el.addEventListener('change', sync); });
  sync();
  $('#fCam').addEventListener('change', onFile);
  $('#fGal').addEventListener('change', onFile);
}

async function saveEntry(form) {
  const btn = $('#saveBtn'); btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const f = new FormData(form);
    const rec = {
      entry_date: f.get('entry_date') || null,
      vendor: (f.get('vendor') || '').trim(),
      description: (f.get('description') || '').trim(),
      category: (f.get('category') || '').trim(),
      amount: parseFloat(f.get('amount')) || 0,
      gst_percent: parseFloat(f.get('gst_percent')) || 0,
      payment_status: f.get('payment_status'),
      remarks: (f.get('remarks') || '').trim()
    };
    if (rec.gst_percent < 0 || rec.gst_percent > 100) throw new Error('GST % must be between 0 and 100.');
    const total = totalOf(rec);
    if (rec.payment_status === 'Paid') rec.paid_amount = total;
    else if (rec.payment_status === 'Unpaid') rec.paid_amount = 0;
    else {
      rec.paid_amount = parseFloat(f.get('paid_amount')) || 0;
      if (!(rec.paid_amount > 0 && rec.paid_amount < total)) throw new Error('For a partial payment, enter an amount paid that is more than 0 and less than the total including GST.');
    }
    const existing = editingId ? S.entries.find(x => x.id === editingId) : null;
    const oldPath = existing?.photo_path || null;
    let photoChanged = false;
    if (pendingPhoto) {
      const blob = await compress(pendingPhoto);
      const path = `${S.pid}/${S.sid}/${crypto.randomUUID()}.jpg`;
      const up = await sb.storage.from('bills').upload(path, blob, { contentType: 'image/jpeg' });
      if (up.error) throw up.error;
      rec.photo_path = path; photoChanged = true;
    } else if (removePhoto && oldPath) { rec.photo_path = null; photoChanged = true; }

    let res;
    if (existing) res = await sb.from('entries').update({ ...rec, updated_at: new Date().toISOString() }).eq('id', existing.id);
    else res = await sb.from('entries').insert({ ...rec, sheet_id: S.sid, project_id: S.pid, created_by: S.user.email });
    if (res.error) throw res.error;
    if (photoChanged && oldPath) await sb.storage.from('bills').remove([oldPath]);
    closeDlg(); toast('Saved');
    await loadProject(S.pid);
  } catch (err) {
    toast(err.message || 'Could not save', true);
    btn.disabled = false; btn.textContent = 'Save';
  }
}

// ---------- clients / admins dialogs ----------
async function clientsDialog() {
  const { data, error } = await sb.from('project_clients').select('email').eq('project_id', S.pid).order('email');
  if (error) return toast(error.message, true);
  openDlg(`
    <h3>Client access · ${esc(curProject().name)}</h3>
    <p class="muted" style="margin-top:0">These emails can sign in (Google or email/password) and will see <b>only this project</b>.</p>
    <ul class="list">${data.length ? data.map(c => `<li><span>${esc(c.email)}</span><button class="btn small danger" data-act="rmClient" data-email="${esc(c.email)}">Remove</button></li>`).join('') : '<li class="muted">No clients added yet.</li>'}</ul>
    <form id="addClientForm" class="row">
      <input type="email" name="email" placeholder="client@gmail.com" required class="grow">
      <button class="btn primary" type="submit">Add client</button>
    </form>
    <div class="row" style="margin-top:12px;justify-content:flex-end"><button class="btn" data-act="closeDlg">Done</button></div>`);
}

async function adminsDialog() {
  const { data, error } = await sb.from('admins').select('email').order('email');
  if (error) return toast(error.message, true);
  openDlg(`
    <h3>Admins</h3>
    <p class="muted" style="margin-top:0">Admins can see every project and add or edit entries, sheets, clients and photos.</p>
    <ul class="list">${data.map(a => `<li><span>${esc(a.email)}</span>${a.email.toLowerCase() === S.user.email.toLowerCase() ? '<span class="muted">you</span>' : `<button class="btn small danger" data-act="rmAdmin" data-email="${esc(a.email)}">Remove</button>`}</li>`).join('')}</ul>
    <form id="addAdminForm" class="row">
      <input type="email" name="email" placeholder="partner@gmail.com" required class="grow">
      <button class="btn primary" type="submit">Add admin</button>
    </form>
    <div class="row" style="margin-top:12px;justify-content:flex-end"><button class="btn" data-act="closeDlg">Done</button></div>`);
}

// ---------- exports ----------
async function exportPDF() {
  const p = curProject();
  toast('Building PDF… photos may take a moment');
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const paths = [...new Set(S.entries.map(e => e.photo_path).filter(Boolean))];
    const longUrls = {};
    if (paths.length) {
      const { data } = await sb.storage.from('bills').createSignedUrls(paths, 60 * 60 * 24 * 365);
      (data || []).forEach(d => { if (d.signedUrl) longUrls[d.path] = d.signedUrl; });
    }
    // Small thumbnails to embed in the PDF
    const thumbs = {};
    await Promise.all(paths.map(async path => {
      try {
        const blob = await (await fetch(S.urls[path] || longUrls[path])).blob();
        const bmp = await createImageBitmap(blob);
        const r = 260 / Math.max(bmp.width, bmp.height, 260);
        const c = document.createElement('canvas');
        c.width = Math.round(bmp.width * Math.min(1, r)); c.height = Math.round(bmp.height * Math.min(1, r));
        c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
        const bw = 21, bh = 21, k = Math.min(bw / c.width, bh / c.height);
        thumbs[path] = { d: c.toDataURL('image/jpeg', 0.7), w: c.width * k, h: c.height * k };
      } catch { /* no thumbnail; link still works */ }
    }));

    let grand = 0, gPaid = 0, first = true;
    const stamp = new Date().toLocaleString('en-IN');
    for (const sh of S.sheets) {
      const rows = S.entries.filter(e => e.sheet_id === sh.id);
      if (!first) doc.addPage(); first = false;
      doc.setFontSize(15); doc.text(`${p.name} — ${sh.name}`, 10, 12);
      doc.setFontSize(8); doc.setTextColor(110);
      doc.text(`HNJ Architects · Project Expenses · Generated ${stamp}. Click a bill photo to open the full-size image.`, 10, 17);
      doc.setTextColor(0);
      const tBase = rows.reduce((a, e) => a + Number(e.amount || 0), 0);
      const tGst = rows.reduce((a, e) => a + gstOf(e), 0);
      const total = rows.reduce((a, e) => a + totalOf(e), 0); grand += total;
      const tPaid = rows.reduce((x, e) => x + paidOf(e), 0); gPaid += tPaid;
      doc.autoTable({
        startY: 20,
        head: [['#', 'Date', 'Vendor', 'Description', 'Category', 'Amount (Rs.)', 'GST %', 'GST (Rs.)', 'Total incl. GST (Rs.)', 'Paid (Rs.)', 'Balance (Rs.)', 'Status', 'Remarks', 'Client remarks', 'Photo']],
        body: rows.map((e, i) => [
          i + 1, dmy(e.entry_date), e.vendor || '', e.description || '', e.category || '',
          num2(e.amount), Number(e.gst_percent) || 0, num2(gstOf(e)), num2(totalOf(e)), num2(paidOf(e)), num2(balOf(e)), e.payment_status, e.remarks || '', e.client_remarks || '',
          e.photo_path ? { content: '', styles: { minCellHeight: 24 } } : '—'
        ]),
        foot: [['', '', '', '', 'Total', num2(tBase), '', num2(tGst), num2(total), num2(tPaid), num2(total - tPaid), '', '', '', '']],
        showFoot: 'lastPage',
        styles: { fontSize: 7, cellPadding: 1.2, valign: 'middle', overflow: 'linebreak' },
        headStyles: { fillColor: [31, 77, 58] },
        footStyles: { fillColor: [235, 235, 228], textColor: 20, fontStyle: 'bold' },
        columnStyles: { 0: { cellWidth: 7 }, 1: { cellWidth: 17 }, 2: { cellWidth: 21 }, 3: { cellWidth: 32 }, 4: { cellWidth: 17 },
                        5: { cellWidth: 19, halign: 'right' }, 6: { cellWidth: 10, halign: 'right' }, 7: { cellWidth: 16, halign: 'right' }, 8: { cellWidth: 21, halign: 'right' },
                        9: { cellWidth: 19, halign: 'right' }, 10: { cellWidth: 19, halign: 'right' }, 11: { cellWidth: 13 }, 12: { cellWidth: 21 }, 13: { cellWidth: 21 }, 14: { cellWidth: 24 } },
        margin: { left: 10, right: 10, bottom: 12 },
        didDrawCell: d => {
          if (d.section !== 'body' || d.column.index !== 14) return;
          const e = rows[d.row.index];
          if (!e || !e.photo_path) return;
          const t = thumbs[e.photo_path];
          if (t) doc.addImage(t.d, 'JPEG', d.cell.x + 1.5, d.cell.y + 1, t.w, t.h);
          else doc.text('Open photo', d.cell.x + 2, d.cell.y + d.cell.height / 2, { baseline: 'middle' });
          const url = longUrls[e.photo_path];
          if (url) doc.link(d.cell.x, d.cell.y, d.cell.width, d.cell.height, { url });
        }
      });
    }
    if (S.sheets.length > 1) {
      doc.setFontSize(11);
      const y = doc.lastAutoTable.finalY + 8;
      doc.text(`Project total (incl. GST): Rs. ${num2(grand)}    Paid: Rs. ${num2(gPaid)}    Balance: Rs. ${num2(grand - gPaid)}`, 10, y > 195 ? 195 : y);
    }
    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) { doc.setPage(i); doc.setFontSize(8); doc.setTextColor(120); doc.text(`Page ${i} of ${pages}`, 287, 205, { align: 'right' }); }
    doc.save(`${p.name.replace(/[^\w\- ]+/g, '').trim() || 'ledger'}.pdf`);
    toast('PDF ready');
  } catch (err) { toast('PDF failed: ' + (err.message || err), true); }
}

function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

async function exportCSV() {
  const sh = curSheet();
  const rows = S.entries.filter(e => e.sheet_id === sh.id);
  const paths = rows.map(e => e.photo_path).filter(Boolean);
  const urls = {};
  if (paths.length) {
    const { data } = await sb.storage.from('bills').createSignedUrls(paths, 60 * 60 * 24 * 365);
    (data || []).forEach(d => { if (d.signedUrl) urls[d.path] = d.signedUrl; });
  }
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['Date', 'Vendor', 'Description', 'Category', 'Amount (before GST)', 'GST %', 'GST amount', 'Total incl. GST', 'Paid', 'Balance', 'Status', 'Remarks', 'Client remarks', 'Photo link'];
  const lines = [head.map(q).join(',')].concat(rows.map(e =>
    [dmy(e.entry_date), e.vendor, e.description, e.category, e.amount, e.gst_percent || 0, gstOf(e), totalOf(e), paidOf(e), balOf(e), e.payment_status, e.remarks, e.client_remarks, urls[e.photo_path] || ''].map(q).join(',')));
  download(`${curProject().name} - ${sh.name}.csv`, new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }));
}

async function backupAll() {
  toast('Preparing backup… this can take a while with many photos');
  try {
    const [pr, sh, en, cl, ad] = await Promise.all([
      sb.from('projects').select('*'), sb.from('sheets').select('*'), sb.from('entries').select('*'),
      sb.from('project_clients').select('*'), sb.from('admins').select('*')
    ]);
    for (const r of [pr, sh, en, cl, ad]) if (r.error) throw r.error;
    const zip = new window.JSZip();
    zip.file('data.json', JSON.stringify({ exported_at: new Date().toISOString(), projects: pr.data, sheets: sh.data, entries: en.data, project_clients: cl.data, admins: ad.data }, null, 2));
    const paths = [...new Set(en.data.map(e => e.photo_path).filter(Boolean))];
    for (const path of paths) {
      const { data } = await sb.storage.from('bills').download(path);
      if (data) zip.file('photos/' + path, data);
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    download(`ledger-backup-${today()}.zip`, blob);
    toast('Backup downloaded — save it to Google Drive');
  } catch (err) { toast('Backup failed: ' + (err.message || err), true); }
}

// ---------- actions ----------
const actions = {
  async google() {
    const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } });
    if (error) toast(error.message, true);
  },
  async signup() {
    const f = $('#loginForm'); if (!f.reportValidity()) return;
    const { data, error } = await sb.auth.signUp({ email: f.email.value.trim().toLowerCase(), password: f.password.value, options: { emailRedirectTo: location.origin + location.pathname } });
    if (error) return toast(error.message, true);
    toast(data.session ? 'Account created' : 'Check your email to confirm your account, then sign in');
  },
  async logout() { await sb.auth.signOut(); },
  tab(b) { S.sid = b.dataset.id; renderApp(); },
  closeDlg() { closeDlg(); },
  photo(b) { const e = S.entries.find(x => x.id === b.dataset.id); if (e && S.urls[e.photo_path]) window.open(S.urls[e.photo_path], '_blank', 'noopener'); },
  pdf() { exportPDF(); },
  csv() { exportCSV(); },
  backup() { backupAll(); },
  clients() { clientsDialog(); },
  admins() { adminsDialog(); },
  addEntry() { entryForm(null); },
  editEntry(b) { entryForm(S.entries.find(x => x.id === b.dataset.id)); },
  pickCam() { $('#fCam').click(); },
  pickGal() { $('#fGal').click(); },
  rmPhoto() { removePhoto = true; pendingPhoto = null; $('#prev').innerHTML = '<span class="muted">Photo will be removed when you save.</span>'; },
  async delEntry(b) {
    const e = S.entries.find(x => x.id === b.dataset.id);
    if (!e || !confirm('Delete this entry?')) return;
    const { error } = await sb.from('entries').delete().eq('id', e.id);
    if (error) return toast(error.message, true);
    if (e.photo_path) await sb.storage.from('bills').remove([e.photo_path]);
    await loadProject(S.pid);
  },
  async saveRemark(b) {
    const id = b.dataset.id, text = $('#cr-' + id).value;
    b.disabled = true;
    const { error } = await sb.rpc('set_client_remark', { p_entry: id, p_text: text });
    b.disabled = false;
    if (error) return toast(error.message, true);
    const e = S.entries.find(x => x.id === id); if (e) e.client_remarks = text;
    toast('Comment saved');
  },
  async newProject() {
    const name = (prompt('Project name?') || '').trim(); if (!name) return;
    const { data, error } = await sb.from('projects').insert({ name }).select().single();
    if (error) return toast(error.message, true);
    await sb.from('sheets').insert({ project_id: data.id, name: 'Sheet 1' });
    S.pid = data.id; S.sid = null; await loadProjects();
  },
  async renameProject() {
    const name = (prompt('New project name?', curProject().name) || '').trim(); if (!name) return;
    const { error } = await sb.from('projects').update({ name }).eq('id', S.pid);
    if (error) return toast(error.message, true);
    await loadProjects();
  },
  async delProject() {
    const p = curProject();
    if (!confirm(`Delete project "${p.name}" with ALL its sheets, entries and photos? This cannot be undone.`)) return;
    if (prompt('Type DELETE to confirm') !== 'DELETE') return;
    const paths = S.entries.map(e => e.photo_path).filter(Boolean);
    if (paths.length) await sb.storage.from('bills').remove(paths);
    const { error } = await sb.from('projects').delete().eq('id', p.id);
    if (error) return toast(error.message, true);
    S.pid = null; S.sid = null; await loadProjects();
  },
  async newSheet() {
    const name = (prompt('Sheet name?', `Sheet ${S.sheets.length + 1}`) || '').trim(); if (!name) return;
    const { data, error } = await sb.from('sheets').insert({ project_id: S.pid, name }).select().single();
    if (error) return toast(error.message, true);
    S.sid = data.id; await loadProject(S.pid);
  },
  async renameSheet() {
    const name = (prompt('New sheet name?', curSheet().name) || '').trim(); if (!name) return;
    const { error } = await sb.from('sheets').update({ name }).eq('id', S.sid);
    if (error) return toast(error.message, true);
    await loadProject(S.pid);
  },
  async delSheet() {
    const sh = curSheet();
    if (!confirm(`Delete sheet "${sh.name}" and all its entries and photos?`)) return;
    const paths = S.entries.filter(e => e.sheet_id === sh.id).map(e => e.photo_path).filter(Boolean);
    if (paths.length) await sb.storage.from('bills').remove(paths);
    const { error } = await sb.from('sheets').delete().eq('id', sh.id);
    if (error) return toast(error.message, true);
    S.sid = null; await loadProject(S.pid);
  },
  async rmClient(b) {
    const { error } = await sb.from('project_clients').delete().eq('project_id', S.pid).eq('email', b.dataset.email);
    if (error) return toast(error.message, true);
    clientsDialog();
  },
  async rmAdmin(b) {
    if (!confirm(`Remove ${b.dataset.email} as admin?`)) return;
    const { error } = await sb.from('admins').delete().eq('email', b.dataset.email);
    if (error) return toast(error.message, true);
    adminsDialog();
  }
};

// ---------- events ----------
function onClick(ev) {
  const b = ev.target.closest('[data-act]');
  if (!b) return;
  ev.preventDefault();
  const fn = actions[b.dataset.act];
  if (fn) fn(b);
}
root.addEventListener('click', onClick);
dlg.addEventListener('click', ev => { if (ev.target === dlg) closeDlg(); else onClick(ev); });

root.addEventListener('change', ev => {
  if (ev.target.id === 'projSel') { S.sid = null; loadProject(ev.target.value); }
  if (ev.target.id === 'showpw') { $('#loginForm').elements.password.type = ev.target.checked ? 'text' : 'password'; }
});
root.addEventListener('input', ev => {
  if (ev.target.id === 'q') { S.q = ev.target.value; renderTable(); }
});
root.addEventListener('submit', async ev => {
  if (ev.target.id !== 'loginForm') return;
  ev.preventDefault();
  const f = ev.target;
  const em = f.email.value.trim().toLowerCase();
  const { error } = await sb.auth.signInWithPassword({ email: em, password: f.password.value });
  if (error) toast(error.message + ` (email sent: ${em}, password length: ${f.password.value.length})`, true);
});
dlg.addEventListener('submit', async ev => {
  const id = ev.target.id;
  if (id === 'entryForm') { ev.preventDefault(); saveEntry(ev.target); }
  else if (id === 'addClientForm') {
    ev.preventDefault();
    const email = ev.target.email.value.trim().toLowerCase();
    const { error } = await sb.from('project_clients').insert({ project_id: S.pid, email });
    if (error) return toast(error.message, true);
    clientsDialog();
  } else if (id === 'addAdminForm') {
    ev.preventDefault();
    const email = ev.target.email.value.trim().toLowerCase();
    const { error } = await sb.from('admins').insert({ email });
    if (error) return toast(error.message, true);
    adminsDialog();
  }
});

init();
})();
