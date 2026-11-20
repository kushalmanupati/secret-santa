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
    return location.href.split("#")[0] + "#r=" + encode(payload);
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

  function renderResults() {
    const has = !!state.pairs;
    $("results").hidden = !has;
    $("draw").textContent = has ? "Draw new names" : "Draw names";
    $("draw").disabled = state.people.length < 3;
    if (!has) return;
    $("links").innerHTML = state.people.map(p => `<li><span class="name">${esc(p)}</span><span class="btns">
      ${navigator.share ? `<button type="button" class="btn ghost small" data-share="${esc(p)}">Share</button>` : ""}
      <button type="button" class="btn small" data-copy="${esc(p)}">Copy link</button></span></li>`).join("");
    $("pairs").innerHTML = state.people.map(p =>
      `<li><span><b>${esc(p)}</b> <span class="muted">→</span> ${esc(state.pairs[p])}</span></li>`).join("");
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
    else { state.pairs = res.pairs; msg.className = "msg"; msg.textContent = ""; $("pairs").hidden = true; $("peek").textContent = "Show all matches"; }
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
  function route() {
    const m = location.hash.match(/^#r=([\w-]+)$/);
    $("setup-view").hidden = !!m;
    $("reveal-view").hidden = !m;
    if (!m) { document.title = "Secret Santa"; return; }
    let data = null;
    try { data = decode(m[1]); } catch (e) {}
    const ok = data && typeof data.g === "string" && typeof data.r === "string";
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
    document.title = (data.e || "Secret Santa") + " · " + data.g;
  }
  $("rv-btn").addEventListener("click", () => { $("rv-btn").hidden = true; $("rv-lede").hidden = true; $("rv-result").hidden = false; });
  window.addEventListener("hashchange", route);

  renderEvent(); render(); route();
})();
