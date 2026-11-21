/* Secret Santa: a static app, no server. State lives in localStorage. */

// ---------- Matching ----------

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Returns true when giver `g` must not draw receiver `r`.
function makeBlocked(rules) {
  const set = new Set();
  for (const x of rules) {
    set.add(x.a + "\u0000" + x.b);
    if (x.both) set.add(x.b + "\u0000" + x.a);
  }
  return (g, r) => g === r || set.has(g + "\u0000" + r);
}

// Finds a random assignment giver -> receiver that respects every rule.
// Returns { pairs } or { error }.
function solve(names, rules, noMutual) {
  const n = names.length;
  if (n < 3) return { error: "Add at least three people." };
  const blocked = makeBlocked(rules);
  const ok = (g, r, asg) => !blocked(g, r) && !(noMutual && asg[r] === g);

  // Explain the obvious dead ends first.
  for (const g of names) {
    if (!names.some(r => !blocked(g, r))) return { error: `${g} has nobody left to draw. Remove one of their rules.` };
  }
  for (const r of names) {
    if (!names.some(g => !blocked(g, r))) return { error: `Nobody is allowed to draw ${r}. Remove one of their rules.` };
  }

  // 1) Random permutations: quick, and every valid result is equally likely.
  for (let t = 0; t < 4000; t++) {
    const p = shuffle(names.slice());
    const asg = {};
    let good = true;
    for (let i = 0; i < n; i++) {
      if (!ok(names[i], p[i], asg)) { good = false; break; }
      asg[names[i]] = p[i];
    }
    if (good) return { pairs: asg };
  }

  // 2) Heavily constrained groups: randomised backtracking, most constrained giver first.
  const options = g => names.filter(r => !blocked(g, r)).length;
  const order = shuffle(names.slice()).sort((a, b) => options(a) - options(b));
  const used = new Set();
  const asg = {};
  let steps = 0;
  const bt = i => {
    if (i === n) return true;
    if (++steps > 200000) return false;
    const g = order[i];
    for (const r of shuffle(names.filter(x => !used.has(x)))) {
      if (!ok(g, r, asg)) continue;
      asg[g] = r; used.add(r);
      if (bt(i + 1)) return true;
      delete asg[g]; used.delete(r);
    }
    return false;
  };
  if (bt(0)) return { pairs: asg };
  return { error: "These rules leave no way to match everyone. Try removing a rule" + (noMutual ? " or allowing two people to draw each other." : ".") };
}

// ---------- Private links ----------
// Light obfuscation so a match isn't readable at a glance. Not encryption.

const SALT = [83, 97, 110, 116, 97, 33, 55, 120];
function encode(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let s = "";
  bytes.forEach((b, i) => { s += String.fromCharCode(b ^ SALT[i % SALT.length]); });
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function decode(str) {
  const s = atob(str.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(s, (c, i) => c.charCodeAt(0) ^ SALT[i % SALT.length]);
  return JSON.parse(new TextDecoder().decode(bytes));
}

if (typeof module !== "undefined") module.exports = { solve, encode, decode };

// ---------- UI ----------

if (typeof document !== "undefined") (function () {
  const KEY = "secret-santa-v1";
  const $ = id => document.getElementById(id);
  const fresh = () => ({ event: { name: "", budget: "", date: "" }, people: [], rules: [], noMutual: false, pairs: null });

  let state;
  try { state = Object.assign(fresh(), JSON.parse(localStorage.getItem(KEY)) || {}); } catch (e) { state = fresh(); }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} };

  // ----- reveal tracking (Firestore REST, no SDK) -----
  // Stores only { drawId, token, time }. Names and matches stay in the links.
  const FB = window.SANTA_FIREBASE || {};
  const tracking = !!(FB.apiKey && FB.projectId);
  const fsBase = () => `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(FB.projectId)}/databases/(default)/documents`;

  function rid(n) {
    const abc = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const v = crypto.getRandomValues(new Uint8Array(n));
    return Array.from(v, x => abc[x % abc.length]).join("");
  }

  function markRevealed(drawId, token) {
    if (!tracking || !drawId || !token) return;
    const url = `${fsBase()}/draws/${encodeURIComponent(drawId)}/reveals?documentId=${encodeURIComponent(token)}&key=${encodeURIComponent(FB.apiKey)}`;
    // A second reveal of the same link is refused by the rules, which is fine.
    fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, keepalive: true,
      body: JSON.stringify({ fields: { at: { timestampValue: new Date().toISOString() } } }) }).catch(() => {});
  }

  // Resolves to { token: Date } for everyone who has revealed.
  async function fetchReveals(drawId) {
    const out = {};
    let page = "";
    do {
      const url = `${fsBase()}/draws/${encodeURIComponent(drawId)}/reveals?pageSize=300&key=${encodeURIComponent(FB.apiKey)}` + (page ? "&pageToken=" + encodeURIComponent(page) : "");
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const j = await res.json();
      (j.documents || []).forEach(d => {
        const t = d.name.split("/").pop();
        out[t] = new Date((d.fields && d.fields.at && d.fields.at.timestampValue) || d.createTime);
      });
      page = j.nextPageToken || "";
    } while (page);
    return out;
  }

  // Wishlists: draws/{drawId}/wishes/{key}, key = first 32 hex chars of
  // sha256(drawId + ":" + lowercase name), so the giver can find the receiver's.
  async function wishKey(drawId, name) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(drawId + ":" + name.trim().toLowerCase()));
    return Array.from(new Uint8Array(buf)).slice(0, 16).map(x => x.toString(16).padStart(2, "0")).join("");
  }
  async function loadWishes(drawId, name) {
    const k = await wishKey(drawId, name);
    const res = await fetch(`${fsBase()}/draws/${encodeURIComponent(drawId)}/wishes/${k}?key=${encodeURIComponent(FB.apiKey)}`, { cache: "no-store" });
    if (res.status === 404) return [];
    if (!res.ok) throw new Error("HTTP " + res.status);
    const j = await res.json();
    const vals = (j.fields && j.fields.items && j.fields.items.arrayValue && j.fields.items.arrayValue.values) || [];
    return vals.map(v => v.stringValue).filter(Boolean);
  }
  async function saveWishes(drawId, name, items) {
    const k = await wishKey(drawId, name);
    const body = { fields: {
      items: { arrayValue: items.length ? { values: items.map(s => ({ stringValue: s })) } : {} },
      at: { timestampValue: new Date().toISOString() }
    } };
    const res = await fetch(`${fsBase()}/draws/${encodeURIComponent(drawId)}/wishes/${k}?key=${encodeURIComponent(FB.apiKey)}`,
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error("HTTP " + res.status);
  }

  function ago(d) {
    const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + " min ago";
    if (s < 86400) return Math.floor(s / 3600) + " h ago";
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short" }) + ", " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  const pill = at => at ? `<span class="pill done">Revealed</span>` : `<span class="pill wait">Pending</span>`;

  // Poll while a tracking view is on screen.
  let pollTimer = null;
  function poll(fn) {
    clearInterval(pollTimer);
    if (!fn) return;
    fn();
    pollTimer = setInterval(() => { if (!document.hidden) fn(); }, 15000);
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden && pollTimer && pollFn) pollFn(); });
  let pollFn = null;
  function startPoll(fn) { pollFn = fn; poll(fn); }
  function stopPoll() { pollFn = null; poll(null); }

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const same = (a, b) => a.toLowerCase() === b.toLowerCase();

  function fmtDate(d) {
    if (!d) return "";
    const [y, m, day] = d.split("-").map(Number);
    return new Date(y, m - 1, day).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  }

  function linkFor(giver) {
    const e = state.event;
    const payload = { g: giver, r: state.pairs[giver], e: e.name || "", b: e.budget || "", d: e.date || "" };
    if (state.drawId && state.tokens && state.tokens[giver]) { payload.i = state.drawId; payload.t = state.tokens[giver]; }
    return location.href.split("#")[0] + "#r=" + encode(payload);
  }
  function statusLink() {
    const payload = { i: state.drawId, e: state.event.name || "", p: state.people.map(p => [p, state.tokens[p]]) };
    return location.href.split("#")[0] + "#s=" + encode(payload);
  }

  async function copy(text, btn, label) {
    try { await navigator.clipboard.writeText(text); }
    catch (e) {
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } catch (e2) {}
      ta.remove();
    }
    if (btn) {
      btn.textContent = "Copied"; btn.classList.add("done");
      clearTimeout(btn._t);
      btn._t = setTimeout(() => { btn.textContent = label; btn.classList.remove("done"); }, 1600);
    }
  }

  // Any change to people, rules or event details makes old links stale.
  function invalidate(msg) {
    if (state.pairs) {
      state.pairs = null;
      $("draw-msg").className = "msg";
      $("draw-msg").textContent = msg || "Setup changed, so draw again to get new links.";
    }
  }

  // ----- render -----
  function renderPeople() {
    const n = state.people.length;
    $("people-count").textContent = n ? n + (n === 1 ? " person" : " people") : "";
    $("people-empty").hidden = n >= 3;
    $("people").innerHTML = state.people.map((p, i) =>
      `<li class="chip"><span>${esc(p)}</span><button type="button" data-i="${i}" aria-label="Remove ${esc(p)}">×</button></li>`).join("");
  }

  function renderRuleForm() {
    const opts = state.people.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join("");
    const a = $("rule-a"), b = $("rule-b"), va = a.value, vb = b.value;
    a.innerHTML = `<option value="">Person</option>` + opts;
    b.innerHTML = `<option value="">Person</option>` + opts;
    if (state.people.includes(va)) a.value = va;
    if (state.people.includes(vb)) b.value = vb;
    $("rule-mid").textContent = $("rule-both").checked ? "and" : "won't get";
    const dis = state.people.length < 2;
    a.disabled = b.disabled = dis;
    $("add-rule").querySelector("button").disabled = dis;
  }

  function renderRules() {
    const n = state.rules.length;
    $("rules-count").textContent = n ? n + (n === 1 ? " rule" : " rules") : "";
    $("rules").innerHTML = state.rules.map((r, i) => `<li><span>${r.both
      ? `<b>${esc(r.a)}</b> <span class="muted">and</span> <b>${esc(r.b)}</b> <span class="muted">won't get each other</span>`
      : `<b>${esc(r.a)}</b> <span class="muted">won't get</span> <b>${esc(r.b)}</b>`}</span>
      <button type="button" class="link-btn" data-i="${i}">Remove</button></li>`).join("");
    $("no-mutual").checked = !!state.noMutual;
  }

  // A draw made before tracking existed: keep its matches, add tracking IDs.
  if (state.pairs && !state.drawId) {
    state.drawId = rid(20);
    state.tokens = Object.fromEntries(state.people.map(p => [p, rid(12)]));
    save();
  }

  let reveals = {};
  const tracked = () => tracking && !!state.drawId && !!state.tokens;

  function renderLinks() {
    const t = tracked();
    $("links").innerHTML = state.people.map(p => {
      const at = t ? reveals[state.tokens[p]] : null;
      return `<li><span class="who"><span class="name">${esc(p)}</span>${at ? `<span class="when">Revealed ${esc(ago(at))}</span>` : ""}</span><span class="btns">
        ${t ? pill(at) : ""}
        ${navigator.share ? `<button type="button" class="btn ghost small" data-share="${esc(p)}">Share</button>` : ""}
        <button type="button" class="btn small" data-copy="${esc(p)}">Copy link</button></span></li>`;
    }).join("");
    if (t) {
      const n = state.people.filter(p => reveals[state.tokens[p]]).length;
      $("progress").innerHTML = `<b>${n} of ${state.people.length}</b> have revealed their match`;
    }
  }

  async function refreshOrganizer() {
    if (!tracked() || !state.pairs) return;
    try { reveals = await fetchReveals(state.drawId); renderLinks(); } catch (e) {}
  }

  function renderResults() {
    const has = !!state.pairs;
    $("results").hidden = !has;
    $("draw").textContent = has ? "Draw new names" : "Draw names";
    $("draw").disabled = state.people.length < 3;
    if (!has) { stopPoll(); return; }
    const t = tracked();
    $("progress").hidden = !t;
    $("status-box").hidden = !t;
    if (t) $("status-open").href = statusLink();
    renderLinks();
    $("pairs").innerHTML = state.people.map(p =>
      `<li><span><b>${esc(p)}</b> <span class="muted">→</span> ${esc(state.pairs[p])}</span></li>`).join("");
    if (t && pollFn !== refreshOrganizer && !location.hash) startPoll(refreshOrganizer);
  }

  function renderEvent() {
    $("ev-name").value = state.event.name || "";
    $("ev-budget").value = state.event.budget || "";
    $("ev-date").value = state.event.date || "";
  }

  function render() { renderPeople(); renderRuleForm(); renderRules(); renderResults(); }

  // ----- events -----
  $("add-person").addEventListener("submit", e => {
    e.preventDefault();
    const input = $("person-name");
    const names = input.value.split(/[,\n;]+/).map(s => s.trim().replace(/\s+/g, " ")).filter(Boolean);
    const skipped = [];
    let added = 0;
    for (const nm of names) {
      if (state.people.some(p => same(p, nm))) { skipped.push(nm); continue; }
      state.people.push(nm); added++;
    }
    input.value = "";
    if (added) invalidate();
    $("draw-msg").className = "msg";
    if (skipped.length) $("draw-msg").textContent = `Already added: ${skipped.join(", ")}. Use a last initial to tell people apart.`;
    save(); render(); input.focus();
  });
  $("person-name").addEventListener("paste", e => {
    const t = (e.clipboardData || window.clipboardData).getData("text");
    if (/[\n,;]/.test(t)) { e.preventDefault(); $("person-name").value = t; $("add-person").requestSubmit(); }
  });

  $("people").addEventListener("click", e => {
    const b = e.target.closest("button[data-i]");
    if (!b) return;
    const name = state.people[+b.dataset.i];
    state.people.splice(+b.dataset.i, 1);
    state.rules = state.rules.filter(r => r.a !== name && r.b !== name);
    invalidate();
    save(); render();
  });

  $("rule-both").addEventListener("change", renderRuleForm);
  $("add-rule").addEventListener("submit", e => {
    e.preventDefault();
    const a = $("rule-a").value, b = $("rule-b").value, both = $("rule-both").checked;
    const msg = $("draw-msg");
    if (!a || !b) { msg.className = "msg error"; msg.textContent = "Pick two people for the rule."; return; }
    if (a === b) { msg.className = "msg error"; msg.textContent = "Pick two different people."; return; }
    const covered = (x, y) => state.rules.some(r => (r.a === x && r.b === y) || (r.both && r.a === y && r.b === x));
    if (both ? covered(a, b) && covered(b, a) : covered(a, b)) { msg.className = "msg"; msg.textContent = "That rule is already there."; return; }
    if (both) state.rules = state.rules.filter(r => !((r.a === a && r.b === b) || (r.a === b && r.b === a)));
    state.rules.push({ a, b, both });
    msg.textContent = "";
    invalidate();
    $("rule-a").value = ""; $("rule-b").value = "";
    save(); render();
  });
  $("rules").addEventListener("click", e => {
    const b = e.target.closest("button[data-i]");
    if (!b) return;
    state.rules.splice(+b.dataset.i, 1);
    invalidate();
    save(); render();
  });
  $("no-mutual").addEventListener("change", e => { state.noMutual = e.target.checked; invalidate(); save(); render(); });

  [["ev-name", "name"], ["ev-budget", "budget"], ["ev-date", "date"]].forEach(([id, k]) => {
    $(id).addEventListener("input", e => {
      state.event[k] = e.target.value;
      if (state.pairs) { $("draw-msg").className = "msg"; $("draw-msg").textContent = "Event details changed. Copy the links again so they show the new details."; }
      save();
    });
  });

  function draw() {
    const res = solve(state.people, state.rules, state.noMutual);
    const msg = $("draw-msg");
    if (res.error) { state.pairs = null; msg.className = "msg error"; msg.textContent = res.error; }
    else {
      state.pairs = res.pairs;
      state.drawId = rid(20);
      state.tokens = Object.fromEntries(state.people.map(p => [p, rid(12)]));
      reveals = {};
      msg.className = "msg"; msg.textContent = "";
      $("pairs").hidden = true; $("peek").textContent = "Show all matches";
    }
    stopPoll();
    save(); render();
    if (!res.error) $("results").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  $("draw").addEventListener("click", draw);
  $("redraw").addEventListener("click", draw);

  $("links").addEventListener("click", e => {
    const c = e.target.closest("[data-copy]");
    if (c) return copy(linkFor(c.dataset.copy), c, "Copy link");
    const s = e.target.closest("[data-share]");
    if (s) navigator.share({ title: "Your Secret Santa match", text: `Hi ${s.dataset.share}, here's your Secret Santa match:`, url: linkFor(s.dataset.share) }).catch(() => {});
  });
  $("copy-all").addEventListener("click", e => {
    const text = state.people.map(p => `${p}: ${linkFor(p)}`).join("\n");
    copy(text, e.currentTarget, "Copy all links");
  });
  $("status-copy").addEventListener("click", e => copy(statusLink(), e.currentTarget, "Copy link"));
  $("peek").addEventListener("click", e => {
    const p = $("pairs");
    p.hidden = !p.hidden;
    e.currentTarget.textContent = p.hidden ? "Show all matches" : "Hide matches";
  });

  let resetArmed = false;
  $("reset").addEventListener("click", e => {
    const b = e.currentTarget;
    if (!resetArmed) {
      resetArmed = true; b.textContent = "Tap again to clear everything";
      setTimeout(() => { resetArmed = false; b.textContent = "Start over"; }, 3000);
      return;
    }
    resetArmed = false; b.textContent = "Start over";
    state = fresh(); save(); renderEvent(); render();
    $("draw-msg").textContent = "";
  });

  // ----- participant reveal -----
  let revealData = null;

  function routeStatus(code) {
    let data = null;
    try { data = decode(code); } catch (e) {}
    const ok = data && typeof data.i === "string" && Array.isArray(data.p);
    $("st-event").textContent = (data && data.e) || "Secret Santa";
    document.title = "Who's revealed · " + ((data && data.e) || "Secret Santa");
    const err = $("st-error");
    if (!ok) { $("st-summary").textContent = "This status link looks broken."; $("st-list").innerHTML = ""; return; }
    if (!tracking) { $("st-summary").textContent = "Reveal tracking isn't set up on this site."; return; }
    const draw = rs => {
      const n = data.p.filter(([, t]) => rs[t]).length;
      $("st-summary").textContent = n === data.p.length ? `Everyone has revealed their match. 🎄` : `${n} of ${data.p.length} have revealed their match.`;
      const rows = data.p.slice().sort((a, b) => (!!rs[b[1]] - !!rs[a[1]]) || a[0].localeCompare(b[0]));
      $("st-list").innerHTML = rows.map(([name, t]) => `<li><span class="who"><span class="name">${esc(name)}</span>${rs[t] ? `<span class="when">${esc(ago(rs[t]))}</span>` : ""}</span>${pill(rs[t])}</li>`).join("");
    };
    draw({});
    startPoll(async () => {
      try {
        const rs = await fetchReveals(data.i);
        err.hidden = true; draw(rs);
        $("st-updated").textContent = "Updates every 15 seconds · last checked " + new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
      } catch (e) { err.hidden = false; err.textContent = "Couldn't reach the server. Retrying…"; }
    });
  }

  function route() {
    const s = location.hash.match(/^#s=([\w-]+)$/);
    const m = location.hash.match(/^#r=([\w-]+)$/);
    $("setup-view").hidden = !!(m || s);
    $("reveal-view").hidden = !m;
    $("status-view").hidden = !s;
    stopPoll();
    if (s) return routeStatus(s[1]);
    if (!m) { document.title = "Secret Santa"; renderResults(); return; }
    let data = null;
    try { data = decode(m[1]); } catch (e) {}
    const ok = data && typeof data.g === "string" && typeof data.r === "string";
    revealData = ok ? data : null;
    $("rv-error").hidden = ok;
    $("rv-btn").hidden = !ok;
    $("rv-lede").hidden = !ok;
    $("rv-result").hidden = true;
    if (!ok) { $("rv-hello").textContent = "Hmm."; return; }
    $("rv-event").textContent = data.e || "Secret Santa";
    $("rv-hello").textContent = `Hi ${data.g}!`;
    $("rv-name").textContent = data.r;
    const meta = [];
    if (data.b) meta.push(`<div><dt>Budget</dt><dd>${esc(data.b)}</dd></div>`);
    if (data.d) meta.push(`<div><dt>Exchange</dt><dd>${esc(fmtDate(data.d))}</dd></div>`);
    $("rv-meta").innerHTML = meta.join("");

    // Own wishlist: shown when this link belongs to a tracked draw.
    const wishes = tracking && !!data.i;
    $("wish-form").hidden = !wishes;
    $("rv-wish").hidden = true;
    $("wish-msg").textContent = ""; $("wish-msg").className = "wish-msg";
    if (wishes) {
      $("wish-1").value = ""; $("wish-2").value = "";
      $("wish-save").textContent = "Save wishlist";
      loadWishes(data.i, data.g).then(items => {
        if (revealData !== data) return;
        $("wish-1").value = items[0] || ""; $("wish-2").value = items[1] || "";
        if (items.length) { $("wish-save").textContent = "Update wishlist"; }
      }).catch(() => {});
    }
    document.title = (data.e || "Secret Santa") + " · " + data.g;
  }
  $("rv-btn").addEventListener("click", () => {
    $("rv-btn").hidden = true; $("rv-lede").hidden = true; $("rv-result").hidden = false;
    const data = revealData;
    if (!data) return;
    markRevealed(data.i, data.t);
    if (!(tracking && data.i)) return;
    // Show the match's wishlist, checking again until they've added one.
    $("rv-wish").hidden = false;
    $("rv-wish-title").textContent = `${data.r}'s wishlist`;
    $("rv-wish-list").innerHTML = "";
    $("rv-wish-empty").hidden = false;
    $("rv-wish-empty").textContent = "Loading…";
    startPoll(async () => {
      try {
        const items = await loadWishes(data.i, data.r);
        if (revealData !== data) return;
        $("rv-wish-list").innerHTML = items.map(s => `<li>${esc(s)}</li>`).join("");
        $("rv-wish-list").hidden = !items.length;
        $("rv-wish-empty").hidden = !!items.length;
        $("rv-wish-empty").textContent = `${data.r} hasn't added a wishlist yet. This updates on its own, so check back later.`;
      } catch (e) {
        $("rv-wish-empty").textContent = "Couldn't load the wishlist. Retrying…";
      }
    });
  });

  $("wish-form").addEventListener("submit", async e => {
    e.preventDefault();
    const data = revealData;
    if (!data || !data.i) return;
    const items = [$("wish-1").value, $("wish-2").value].map(s => s.trim().replace(/\s+/g, " ").slice(0, 120)).filter(Boolean);
    const msg = $("wish-msg"), btn = $("wish-save");
    btn.disabled = true; msg.className = "wish-msg"; msg.textContent = "Saving…";
    try {
      await saveWishes(data.i, data.g, items);
      msg.className = "wish-msg ok";
      msg.textContent = items.length ? "Saved. Your Secret Santa will see it." : "Wishlist cleared.";
      btn.textContent = items.length ? "Update wishlist" : "Save wishlist";
    } catch (err) {
      msg.className = "wish-msg err"; msg.textContent = "Couldn't save. Please try again.";
    }
    btn.disabled = false;
  });
  window.addEventListener("hashchange", route);

  renderEvent(); render(); route();
})();
