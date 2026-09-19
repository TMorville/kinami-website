// omfavn web demo. A reconstruction of the iOS app for the seed deck, not the shipped app.
// State lives in memory only. Everything Oline says comes from seed.js (production prompt output).
// Runs standalone or inside the deck's iframe, driven by semantic postMessage commands.
(function () {
  var S = window.OMFAVN_SEED;
  if (!S || !S.letter || !S.journal) {
    document.getElementById('screen').innerHTML = '<h2 class="title" style="margin-top:40px">Demo data missing</h2><div class="body dim"><p>app/seed.js did not load. Run deck/tools/build_app_seed.py.</p></div>';
    if (window.parent !== window) window.parent.postMessage({ type: 'omfavn-app', evt: 'error' }, '*');
    return;
  }
  var $ = function (id) { return document.getElementById(id); };
  var screen = $('screen'), tabsEl = $('tabs'), sheetWrap = $('sheet-wrap'), sheetEl = $('sheet'), audio = $('narration');

  // Dates are day strings; walk them in UTC so the viewer's timezone cannot shift the week (UTC+13 turned 2 March into 1 March).
  var WEEK = []; (function () { var d = new Date(S.letter.window[0] + 'T00:00:00Z'); for (var i = 0; i < 7; i++) { WEEK.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); } })();
  var DOW = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
  var DAYNAME = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  var MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var PHRASE = { 1: 'A tough day', 2: 'A hard day', 3: 'An okay day', 4: 'A good day', 5: 'A great day' };
  var EMOTIONS = ['Stress', 'Calm', 'Joy', 'Frustration', 'Fatigue', 'Pride', 'Gratitude', 'Worry', 'Loneliness', 'Overwhelmed'];
  var MOOD_BG = { 0: '#F5F0E8', 1: '#EFE4DD', 2: '#F2E8DF', 3: '#F5F0E8', 4: '#F5EEDD', 5: '#F6ECD4' };
  // From Models/DailyWisdom.swift
  var WISDOM = [
    'When your child is having a big feeling, they need your calm presence more than your corrections.',
    'Setting a boundary is an act of love. You can hold a limit firmly while still being warm.',
    "After a tough moment, coming back to your child and saying 'I'm sorry' teaches them that rupture can be repaired.",
    "Your child's meltdown is not a reflection of your failure. It's a sign they feel safe enough to fall apart with you.",
    "You don't have to enjoy every moment to be a good parent. It's okay to find some parts genuinely hard.",
    'Two things can be true: you can love your kids deeply and still need a break from them.',
    'Children cooperate more when they feel connected. Connection before correction changes the whole dynamic.'
  ];
  var ARTICLES = {}; S.topics.forEach(function (t) { t.articles.forEach(function (a) { ARTICLES[a.id] = { a: a, t: t }; }); });
  var SEEDED = {}; S.journal.forEach(function (j) { SEEDED[j.date] = j; });

  var st, run = 0, timers = [], lastKey = '', scrolls = {};

  function later(fn, ms) { var r = run; timers.push(setTimeout(function () { if (r === run) fn(); }, ms)); }
  function stopAll() { run++; timers.forEach(clearTimeout); timers = []; audio.pause(); if (st) { st.playing = null; st.pending = {}; } }

  function seededEntry(date) { var j = SEEDED[date]; return { rating: j.rating, emotions: j.emotions.slice(), free_text: j.free_text, seeded: true }; }

  function setBeat(n) {
    stopAll();
    st = { beat: n, now: WEEK[6], hour: 20, min: 12, tab: 'today', day: WEEK[6], stacks: { today: [], oline: [], grow: [], settings: [] }, sheet: null,
      entries: {}, revealed: {}, pending: {}, offline: {}, openEx: {}, asked: [], askDraft: '', toggles: { Morning: true, Dinner: false, Bedtime: true }, playing: null };
    if (n === 1) { st.now = st.day = WEEK[0]; st.hour = 19; st.min = 40; }
    else if (n === 2) { st.now = st.day = WEEK[0]; st.hour = 19; st.min = 46; st.entries[WEEK[0]] = seededEntry(WEEK[0]); st.revealed[WEEK[0]] = true; st.stacks.today = [{ v: 'journal', date: WEEK[0] }]; }
    else if (n === 3) { st.now = st.day = WEEK[1]; st.hour = 7; st.min = 5; st.entries[WEEK[0]] = seededEntry(WEEK[0]); st.revealed[WEEK[0]] = true; }
    else { S.journal.forEach(function (j) { st.entries[j.date] = seededEntry(j.date); st.revealed[j.date] = true; }); st.openEx['ask0'] = false; }
    lastKey = ''; lastScreen = ''; scrolls = {}; try { audio.currentTime = 0; } catch (e) {}
    render();
  }

  // ---------- helpers
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function inline(s) { return esc(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>'); }
  function md(text) {
    return String(text).trim().split(/\n{2,}/).map(function (block) {
      var lines = block.split('\n');
      if (/^#{1,6}\s/.test(lines[0])) return '<h3>' + inline(lines[0].replace(/^#+\s+/, '')) + '</h3>' + (lines.length > 1 ? md(lines.slice(1).join('\n')) : '');
      if (lines.every(function (l) { return /^\s*[-*]\s+/.test(l); })) return '<ul>' + lines.map(function (l) { return '<li>' + inline(l.replace(/^\s*[-*]\s+/, '')) + '</li>'; }).join('') + '</ul>';
      var firstList = lines.findIndex(function (l) { return /^\s*[-*]\s+/.test(l); });
      if (firstList > 0) return md(lines.slice(0, firstList).join(' ')) + md(lines.slice(firstList).join('\n'));
      return '<p>' + inline(lines.join(' ')) + '</p>';
    }).join('');
  }
  function dIdx(date) { return WEEK.indexOf(date); }
  function nice(date) { var d = new Date(date + 'T12:00:00'); return DAYNAME[(d.getDay() + 6) % 7] + ' ' + d.getDate() + ' ' + MONTH[d.getMonth()]; }
  function ago(date) { var n = Math.round((new Date(st.now) - new Date(date)) / 864e5); return n <= 0 ? 'today' : n === 1 ? 'yesterday' : n + ' days ago'; }
  function icon(id) { return '<svg aria-hidden="true"><use href="#' + id + '"/></svg>'; }
  function sessionVisible() { return S.session.date <= st.now; }
  function letterVisible() { return S.letter.date <= st.now; }
  function top() { var s = st.stacks[st.tab]; return s && s.length ? s[s.length - 1] : null; }
  function push(view) { st.stacks[st.tab].push(view); render(); }
  function face(n) {
    var mouth = { 1: 'M9 17.5c2-2.6 4-2.6 6 0', 2: 'M9 16.8c2-1.4 4-1.4 6 0', 3: 'M9 16.2h6', 4: 'M9 15.4c2 1.8 4 1.8 6 0', 5: 'M8.4 14.8c2.4 3.4 4.8 3.4 7.2 0' }[n];
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="10" r="1" fill="currentColor"/><circle cx="15" cy="10" r="1" fill="currentColor"/><path d="' + mouth + '" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
  }

  // ---------- views
  function vToday() {
    var d = st.day, e = st.entries[d], h = '';
    var greet = st.day !== st.now ? nice(d).toLowerCase() + '.' : st.hour < 11 ? 'good morning.' : st.hour < 17 ? 'good afternoon.' : 'good evening.';
    h += '<h1 class="big">' + greet + '</h1><div class="week">';
    WEEK.forEach(function (w, i) {
      var has = (st.entries[w] || (w === S.session.date && sessionVisible())) && w <= st.now;
      h += '<button data-act="day" data-d="' + w + '"' + (w > st.now ? ' disabled' : '') + ' class="' + (w === d ? 'sel' : '') + '" aria-label="' + nice(w) + '"><span class="dow">' + DOW[i] + '</span><span class="num">' + (+w.slice(8)) + '</span>' + (has ? '<span class="dot"></span>' : '') + '</button>';
    });
    h += '</div>';
    if (e) {
      h += '<div class="card tap" data-act="journal" data-d="' + d + '" role="button" tabindex="0"><div class="row"><span class="label">Journal</span>' + (st.revealed[d] ? '<span class="label">Oline wrote back</span>' : '') + '</div>' +
        '<div class="q sm">' + PHRASE[e.rating] + '</div><div class="sub">' + esc(e.free_text.slice(0, 120)) + (e.free_text.length > 120 ? '…' : '') + '</div></div>';
    } else if (d === st.now) {
      var p = S.prompts[d];
      h += '<div class="card"><span class="label">' + (p ? 'Today&rsquo;s question' : 'Daily check-in') + '</span><div class="q">' + esc(p || 'How did today feel as a parent?') + '</div>' +
        (p ? '<div class="sub" style="margin:-6px 0 16px">Oline wrote this from your recent entries.</div>' : '') + '<button class="btn" data-act="begin">Begin</button></div>';
    } else {
      h += '<div class="card"><span class="label dim">Journal</span><div class="sub" style="margin-top:8px">No entry this day.</div></div>';
    }
    if (d === S.session.date && sessionVisible()) {
      h += '<div class="card tap" data-act="session" role="button" tabindex="0"><div class="row"><span class="label">Recording &middot; ' + S.session.time + '</span><span class="label dim">40 sec</span></div><div class="q sm">' + esc(S.session.title) + '</div><div class="sub">' + esc(S.session.summary.slice(0, 110)) + '…</div></div>';
    }
    if (d === S.letter.date && letterVisible()) {
      h += '<div class="card tap" data-act="letter" role="button" tabindex="0"><span class="label">Example Sunday letter</span><div class="q sm">' + esc(S.letter.hero_phrase || 'Your week') + '</div><div class="sub">' + esc(S.letter.hero_context || '') + '</div></div>';
    }
    h += '<div class="wisdom"><q>' + esc(WISDOM[Math.max(0, dIdx(d)) % WISDOM.length]) + '</q><span class="label">Daily wisdom</span></div>';
    return h;
  }

  function vJournal(date) {
    var e = st.entries[date], j = SEEDED[date], h = nav('Today');
    h += '<span class="label">' + nice(date) + '</span><h2 class="title">' + PHRASE[e.rating] + '</h2>';
    if (e.emotions.length) h += '<div class="pills">' + e.emotions.map(function (x) { return '<span class="pill">' + esc(x) + '</span>'; }).join('') + '</div>';
    h += '<div class="body" style="margin-top:20px"><p>' + esc(e.free_text) + '</p></div>';
    if (date === S.session.date && sessionVisible()) h += '<button class="ref" data-act="session"><div><b>Recording &middot; ' + S.session.time + '</b><span>' + esc(S.session.title) + '</span></div>' + icon('i-chev') + '</button>';
    if (e.seeded && st.revealed[date]) {
      var r = j.reflection;
      h += '<div class="oline"><div class="who">' + icon('enso') + '<span class="label" style="color:inherit">Oline</span></div><h3>' + esc(r.reflection_title || '') + '</h3><div class="md">' + md(r.oline_reflection) + '</div></div>';
      (r.article_references || []).forEach(function (id) { if (ARTICLES[id]) h += refRow(id); });
      h += '<div class="note">Written in advance by the production prompt for this exact entry. Not edited. In the app this takes a few seconds.</div>';
    } else if (st.pending[date]) {
      h += '<div class="writing">' + icon('enso') + '<span>Opening the reflection written for this entry&hellip;</span></div>';
    } else {
      h += '<div style="margin-top:26px"><button class="btn wide" data-act="reflect" data-d="' + date + '">Ask Oline to reflect</button></div>';
      if (st.offline[date]) h += '<div class="note">Oline is offline in this web demo, so she cannot read an entry you typed yourself. The example entries have real reflections from the production prompt.</div>';
    }
    return h;
  }
  function refRow(id) { var x = ARTICLES[id]; return '<button class="ref" data-act="article" data-id="' + id + '"><div><b>' + esc(x.a.title) + '</b><span>' + esc(x.t.title) + ' &middot; ' + x.a.reading_time_minutes + ' min' + (x.a.audio ? ' &middot; listen' : '') + '</span></div>' + icon('i-chev') + '</button>'; }
  function nav(label) { return '<div class="nav"><button data-act="back">' + icon('i-back') + esc(label) + '</button></div>'; }
  function player(src) { return '<div class="player" data-src="' + src + '"><button data-act="play" data-src="' + src + '" aria-label="Play or pause">' + icon(st.playing === src ? 'i-pause' : 'i-play') + '</button><div class="track"><u></u></div><span class="t">0:00</span></div>'; }

  function vSession() {
    var s = S.session, h = nav('Back');
    h += '<span class="label">Example session &middot; ' + nice(s.date) + ' &middot; ' + s.time + '</span><h2 class="title">' + esc(s.title) + '</h2>';
    h += player('../assets/demo-dinner.m4a');
    h += '<div class="body"><p>' + esc(s.summary) + '</p></div>';
    if (s.categories_detected.length) h += '<div class="pills">' + s.categories_detected.map(function (c) { return '<span class="pill">' + esc(String(c).replace(/_/g, ' ')) + '</span>'; }).join('') + '</div>';
    h += '<div class="note">A real 40 second recording from the founder&rsquo;s family dinner, with their real names. The session page stays neutral: what happened, who spoke. Oline&rsquo;s coaching lives in the journal.</div>';
    if (st.entries[s.date]) h += '<button class="ref" data-act="journal" data-d="' + s.date + '"><div><b>Journal &middot; ' + nice(s.date) + '</b><span>' + (st.revealed[s.date] ? 'With Oline&rsquo;s reflection' : 'Your entry') + '</span></div>' + icon('i-chev') + '</button>';
    return h;
  }

  function vOline() {
    var h = '<h1 class="big">oline.</h1>', items = [];
    st.asked.forEach(function (q, i) { items.push({ k: 'c' + i, date: st.now, custom: true, q: q }); });
    if (letterVisible()) items.push({ k: 'letter', date: S.letter.date, letter: true });
    S.asks.forEach(function (a, i) { if (a.date <= st.now) items.push({ k: 'ask' + i, date: a.date, q: a.question, a: a.answer }); });
    items.sort(function (x, y) { return (y.custom ? 1 : 0) - (x.custom ? 1 : 0) || (x.date < y.date ? 1 : -1); });
    if (!items.length) h += '<div class="card"><span class="label dim">Nothing yet</span><div class="sub" style="margin-top:8px">Questions you ask and Oline&rsquo;s Sunday letters collect here. In this demo the first ones arrive later in the example week.</div></div>';
    items.forEach(function (it) {
      if (it.letter) { h += '<div class="card tap" data-act="letter" role="button" tabindex="0"><span class="label">Example Sunday letter &middot; ' + ago(it.date) + '</span><div class="q sm">' + esc(S.letter.hero_phrase || '') + '</div><div class="sub">' + esc(S.letter.hero_context || '') + '</div></div>'; return; }
      var open = it.custom || st.openEx[it.k];
      h += '<div class="ex' + (open ? ' open' : '') + '"><button class="head" data-act="ex" data-k="' + it.k + '"><b>' + esc(it.q) + '</b>' + icon('i-chev') + '</button><div class="when">' + ago(it.date) + '</div><div class="ans">' +
        (it.custom ? '<div class="sub">Oline is offline in this web demo. The example questions below have real answers from the production prompt.</div>' : '<div class="md">' + md(it.a) + '</div>') + '</div></div>';
    });
    return h;
  }

  function vLetter() {
    var L = S.letter, h = nav('Back'), a = new Date(L.window[0] + 'T12:00:00'), b = new Date(L.window[1] + 'T12:00:00');
    h += '<span class="label">Example weekly letter &middot; ' + MONTH[a.getMonth()] + ' ' + a.getDate() + '&ndash;' + MONTH[b.getMonth()] + ' ' + b.getDate() + '</span>';
    h += '<div class="hero">' + esc(L.hero_phrase || '') + '</div><div class="body dim"><p>' + esc(L.hero_context || '') + '</p></div>';
    h += '<div class="body" style="margin-top:20px">' + md(L.letter_text || '') + '</div>';
    var counts = WEEK.map(function (w) { return (SEEDED[w] ? 1 : 0) + (w === S.session.date ? 1 : 0); });
    h += '<div class="bars">' + counts.map(function (c) { return '<div class="' + (c === 0 ? 'zero' : c > 1 ? 'hi' : '') + '" style="height:' + (c === 0 ? 3 : c * 32) + 'px"></div>'; }).join('') + '</div><div class="barlab">' + DOW.map(function (x) { return '<span>' + x[0] + '</span>'; }).join('') + '</div>';
    [['Going well', L.going_well], ['Something to try', L.something_to_try], ['For next week', L.forward_nudge], ['A question to sit with', L.reflection_prompt]].forEach(function (s) {
      if (s[1]) h += '<div class="sec"><span class="label dim">' + s[0] + '</span><div class="body">' + md(s[1]) + '</div></div>';
    });
    if ((L.weekly_themes || []).length) h += '<div class="pills" style="margin-top:22px">' + L.weekly_themes.map(function (t) { return '<span class="pill">' + esc(t) + '</span>'; }).join('') + '</div>';
    h += '<div class="note">Written by the production weekly prompt from the three example entries and the recording. Not edited.</div>';
    return h;
  }

  function vGrow() {
    var h = '<h1 class="big">grow.</h1>', rec = [];
    S.journal.forEach(function (j) { if (st.revealed[j.date]) (j.reflection.article_references || []).forEach(function (id) { if (ARTICLES[id] && rec.indexOf(id) < 0) rec.push(id); }); });
    function card(id) { var x = ARTICLES[id]; return '<button class="art" data-act="article" data-id="' + id + '"><b>' + esc(x.a.title) + '</b><span>' + esc(x.a.summary) + '</span><i>' + x.a.reading_time_minutes + ' min' + (x.a.audio ? ' &middot; listen' : '') + '</i></button>'; }
    if (rec.length) h += '<div class="shelf" style="margin-top:4px"><span class="label">From Oline, for you</span><div class="sub">Articles she linked to your entries.</div><div class="rowx">' + rec.map(card).join('') + '</div></div>';
    S.topics.forEach(function (t) { h += '<div class="shelf"><span class="label dim">' + esc(t.title) + '</span><div class="sub">' + esc(t.description) + '</div><div class="rowx">' + t.articles.map(function (a) { return card(a.id); }).join('') + '</div></div>'; });
    return h;
  }
  function vArticle(id) {
    var x = ARTICLES[id], h = nav('Back');
    h += '<span class="label">' + esc(x.t.title) + ' &middot; ' + x.a.reading_time_minutes + ' min read</span><h2 class="title">' + esc(x.a.title) + '</h2><div class="body dim"><p>' + esc(x.a.summary) + '</p></div>';
    h += x.a.audio ? player(x.a.audio) : '<div style="height:18px"></div>';
    return h + '<div class="md">' + md(x.a.body) + '</div>';
  }

  function vSettings() {
    return '<h1 class="big">settings.</h1><div class="list">' + [['family', 'Family', S.family.length + ' members'], ['sub', 'Subscription', 'Household'], ['notif', 'Reminders', ''], ['about', 'About this demo', '']].map(function (r) {
      return '<button data-act="push" data-v="' + r[0] + '"><span>' + r[1] + '</span><span class="row"><small>' + r[2] + '</small>' + icon('i-chev') + '</span></button>'; }).join('') + '</div>';
  }
  function vFamily() { return nav('Settings') + '<h2 class="title">Family</h2><div class="list">' + S.family.map(function (m) { return '<div><span class="row" style="justify-content:flex-start"><span class="avatar ' + (m.role === 'child' ? 'child' : '') + '">' + esc(m.label[0]) + '</span><span>' + esc(m.label) + '</span></span><small>' + (m.role === 'child' ? m.age + ' years' : 'Parent') + '</small></div>'; }).join('') + '</div><div class="note">An invented household. In the app each member also enrols a voice, so recordings know who spoke.</div>'; }
  function vSub() { return nav('Settings') + '<h2 class="title">Subscription</h2><div class="card"><span class="label">omfavn household</span><div class="q sm">&euro;119 a year</div><div class="sub">Or &euro;17.99 a month. One subscription covers both parents. Seven-day trial.</div></div><div class="note">Shown as an example. Nothing can be bought in this demo.</div>'; }
  function vNotif() { return nav('Settings') + '<h2 class="title">Reminders</h2><div class="list">' + Object.keys(st.toggles).map(function (k) { return '<button data-act="toggle" data-k="' + k + '" role="switch" aria-checked="' + st.toggles[k] + '"><span>' + k + '</span><span class="switch ' + (st.toggles[k] ? 'on' : '') + '"></span></button>'; }).join('') + '</div><div class="note">A nudge to record or to write, at the moments that tend to matter.</div>'; }
  function vAbout() { return nav('Settings') + '<h2 class="title">About this demo</h2><div class="body"><p>This is a web reconstruction of the omfavn iOS app, built for the seed deck. It is not the shipped app.</p><p>The household is invented. The parent&rsquo;s entries were written as examples. Everything Oline says was written by the production prompts for exactly those entries, and is not edited. The dinner recording is real: the founder&rsquo;s own family, with their real names. The articles and their narration are the app&rsquo;s own.</p><p>Recording is off, and Oline is offline for anything you type yourself.</p></div><div class="note">' + esc(S.provenance) + '</div>'; }

  // ---------- sheets
  function renderSheet() {
    var sh = st.sheet;
    sheetWrap.classList.toggle('on', !!sh);
    var bar = document.querySelector('.askbar'), had = focusKey();
    sheetWrap.inert = !sh; screen.inert = !!sh; tabsEl.inert = !!sh; if (bar) bar.inert = !!sh;
    if (!sh) { if (sheetEl.innerHTML) { sheetEl.innerHTML = ''; sheetEl.removeAttribute('data-kind'); refocus(opener); opener = null; } announce(); return; }
    var fresh = sheetEl.getAttribute('data-kind') !== sh.kind + (sh.page || 0); sheetEl.setAttribute('data-kind', sh.kind + (sh.page || 0));
    var h = '';
    if (sh.kind === 'record') {
      sheetEl.style.background = '';
      h = '<div class="top"><span class="label">Record</span><button class="link" data-act="close">Done</button></div><div class="recorder">' + icon('enso') + '<h2 class="title" style="margin:0">Recording is off in this web demo.</h2><div class="body dim" style="max-width:30ch">In the app, one tap starts a recording of up to thirty minutes. Oline reads it together with your journal.</div><button class="btn" data-act="example-session">See an example session</button></div>';
    } else {
      sheetEl.style.background = MOOD_BG[sh.rating];
      h = '<div class="top"><button class="link" data-act="close">Cancel</button><div class="steps">' + [0, 1, 2].map(function (i) { return '<i class="' + (i <= sh.page ? 'on' : '') + '"></i>'; }).join('') + '</div><span style="width:52px"></span></div>';
      if (sh.page === 0) {
        h += '<span class="label">' + nice(sh.date) + '</span><h2 class="title">How did today feel as a parent?</h2><div class="faces">' + [1, 2, 3, 4, 5].map(function (n) { return '<button data-act="rate" data-n="' + n + '" class="' + (sh.rating === n ? 'on' : '') + '" aria-label="' + PHRASE[n] + '">' + face(n) + '</button>'; }).join('') + '</div><div class="phrase">' + (PHRASE[sh.rating] || '') + '</div><div class="grow"></div><button class="btn fill wide" data-act="next"' + (sh.rating ? '' : ' disabled') + '>Continue</button>';
      } else if (sh.page === 1) {
        h += '<span class="label">' + PHRASE[sh.rating] + '</span><h2 class="title">What was in it?</h2><div class="pills" style="gap:10px;margin-top:20px">' + EMOTIONS.map(function (e) { return '<button class="pill ' + (sh.emotions.indexOf(e) >= 0 ? 'on' : '') + '" data-act="emo" data-e="' + e + '">' + e + '</button>'; }).join('') + '</div><div class="grow"></div><button class="btn fill wide" data-act="next">Continue</button>';
      } else {
        var p = S.prompts[sh.date];
        h += '<span class="label">' + (sh.emotions.join(' · ') || PHRASE[sh.rating]) + '</span><h2 class="title" style="font-size:28px">' + esc(p || 'What happened today?') + '</h2><textarea id="entry-text" placeholder="A few lines is enough.">' + esc(sh.text) + '</textarea>';
        if (SEEDED[sh.date]) h += '<button class="starter" data-act="starter"><b>Use the example entry</b>Fills in the text, mood and emotions of the example parent for this day, so Oline&rsquo;s real reflection matches it.</button>';
        h += '<div class="grow" style="min-height:16px"></div><button class="btn fill wide" id="save" data-act="save"' + (sh.text.trim() ? '' : ' disabled') + '>Save</button>';
      }
    }
    sheetEl.innerHTML = h; announce();
    if (fresh || !refocus(had, sheetEl)) { var f = sheetEl.querySelector('textarea, .faces button, button.pill, .btn'); if (f) f.focus({ preventScroll: true }); }
  }

  // ---------- focus: renders replace the DOM, so remember which control had focus and give it back
  function focusKey() {
    var el = document.activeElement; if (!el || el === document.body) return null;
    if (el.id) return '#' + el.id;
    if (!el.dataset || !el.dataset.act) return null;
    return Object.keys(el.dataset).map(function (k) { return '[data-' + k.replace(/[A-Z]/g, function (c) { return '-' + c.toLowerCase(); }) + '="' + String(el.dataset[k]).replace(/"/g, '\\"') + '"]'; }).join('');
  }
  function refocus(key, root) { if (!key) return false; var el = (root || document).querySelector(key); if (el && !el.disabled) { el.focus({ preventScroll: true }); return true; } return false; }
  var opener = null;

  // ---------- screen: tell the deck which screen the viewer is on, so the slide can follow
  var lastScreen = '';
  function screenName() {
    var sh = st.sheet, t = top();
    if (sh) return sh.kind === 'record' ? 'record' : 'journal';
    if (!t) return st.tab;
    if (t.v === 'journal') return st.revealed[t.date] && st.entries[t.date].seeded ? 'reflection:' + t.date : 'entry';
    return t.v;
  }
  function announce(force) {
    if (window.parent === window || !st) return;
    var name = screenName(); if (name === lastScreen && !force) return; lastScreen = name;
    window.parent.postMessage({ type: 'omfavn-app', evt: 'screen', name: name }, '*');
  }

  // ---------- render
  function render() {
    var t = top(), key = st.tab + JSON.stringify(t) + (st.tab === 'today' && !t ? st.day : ''), h, bg = '', had = st.sheet ? null : focusKey();
    if (lastKey) scrolls[lastKey] = { y: screen.scrollTop, x: [].map.call(screen.querySelectorAll('.rowx'), function (r) { return r.scrollLeft; }) };
    if (st.toTop) { delete scrolls[key]; st.toTop = false; }
    var keep = scrolls[key] || { y: 0, x: [] };
    if (key !== lastKey && st.playing) { audio.pause(); st.playing = null; }
    if (!t) h = { today: vToday, oline: vOline, grow: vGrow, settings: vSettings }[st.tab]();
    else if (t.v === 'journal') { h = vJournal(t.date); bg = MOOD_BG[st.entries[t.date].rating]; }
    else if (t.v === 'session') h = vSession();
    else if (t.v === 'letter') h = vLetter();
    else if (t.v === 'article') h = vArticle(t.id);
    else h = { family: vFamily, sub: vSub, notif: vNotif, about: vAbout }[t.v]();
    var askbar = st.tab === 'oline' && !t;
    screen.innerHTML = h + (askbar ? '' : '');
    screen.className = 'screen mood' + (askbar ? ' has-askbar' : '');
    screen.style.background = bg; $('phone').style.setProperty('--bg', bg || '#F5F0E8');
    screen.scrollTop = keep.y; [].forEach.call(screen.querySelectorAll('.rowx'), function (r, n) { r.scrollLeft = keep.x[n] || 0; }); lastKey = key;
    var old = document.querySelector('.askbar'); if (old) old.remove();
    if (askbar) { var bar = document.createElement('form'); bar.className = 'askbar'; bar.innerHTML = '<input id="ask-input" type="text" placeholder="Ask Oline&hellip;" autocomplete="off" aria-label="Ask Oline" value="' + esc(st.askDraft) + '"><button type="submit" aria-label="Send">' + icon('i-send') + '</button>'; $('phone').insertBefore(bar, tabsEl); }
    tabsEl.innerHTML = [['today', 'Today', 'i-today'], ['oline', 'Oline', 'i-oline'], ['record', 'Record', 'i-record'], ['grow', 'Grow', 'i-grow'], ['settings', 'Settings', 'i-settings']].map(function (x) {
      return '<button data-act="tab" data-t="' + x[0] + '" class="' + (st.tab === x[0] ? 'on' : '') + '">' + icon(x[2]) + '<span>' + x[1] + '</span></button>'; }).join('');
    $('clock').textContent = st.hour + ':' + (st.min < 10 ? '0' : '') + st.min;
    renderSheet(); syncPlayer();
    if (!st.sheet) refocus(had);
    announce();
  }

  // ---------- audio
  function syncPlayer() {
    var el = document.querySelector('.player'); if (!el) return;
    var mine = el.getAttribute('data-src') === st.playing || (audio.getAttribute('src') === el.getAttribute('data-src'));
    var cur = mine ? audio.currentTime : 0, dur = mine && isFinite(audio.duration) ? audio.duration : 0;
    el.querySelector('u').style.width = (dur ? cur / dur * 100 : 0) + '%';
    el.querySelector('.t').textContent = Math.floor(cur / 60) + ':' + ('0' + Math.floor(cur % 60)).slice(-2);
    el.querySelector('button').innerHTML = icon(st.playing && mine && !audio.paused ? 'i-pause' : 'i-play');
  }
  audio.addEventListener('timeupdate', syncPlayer);
  audio.addEventListener('ended', function () { st.playing = null; syncPlayer(); });
  audio.addEventListener('error', function () { st.playing = null; var t = document.querySelector('.player .t'); if (t) t.textContent = 'n/a'; });
  function togglePlay(src) {
    if (st.playing === src && !audio.paused) { audio.pause(); st.playing = null; syncPlayer(); return; }
    if (audio.getAttribute('src') !== src) audio.setAttribute('src', src);
    st.playing = src;
    var p = audio.play(); if (p && p.catch) p.catch(function () { st.playing = null; syncPlayer(); });
    syncPlayer();
  }

  // ---------- actions
  function act(a, el) {
    var sh = st.sheet;
    if (!sh && ['rate', 'emo', 'next', 'starter', 'save'].indexOf(a) >= 0) return;
    switch (a) {
      case 'tab': if (el.dataset.t === 'record') { opener = '[data-act="tab"][data-t="record"]'; st.sheet = { kind: 'record' }; renderSheet(); return; }
        if (st.tab === el.dataset.t) st.stacks[st.tab] = []; st.tab = el.dataset.t; st.sheet = null; break;
      case 'day': st.day = el.dataset.d; break;
      case 'begin': opener = '[data-act="begin"]'; st.sheet = { kind: 'journal', date: st.now, page: 0, rating: 0, emotions: [], text: '' }; renderSheet(); return;
      case 'close': st.sheet = null; renderSheet(); return;
      case 'rate': sh.rating = +el.dataset.n; renderSheet(); return;
      case 'emo': var i = sh.emotions.indexOf(el.dataset.e); if (i >= 0) sh.emotions.splice(i, 1); else sh.emotions.push(el.dataset.e); renderSheet(); return;
      case 'next': sh.page++; renderSheet(); return;
      case 'starter': var j = SEEDED[sh.date]; sh.text = j.free_text; sh.rating = j.rating; sh.emotions = j.emotions.slice(); sh.starter = true; renderSheet(); return;
      case 'save': var seeded = sh.starter && SEEDED[sh.date] && sh.text.trim() === SEEDED[sh.date].free_text.trim();
        st.entries[sh.date] = seeded ? seededEntry(sh.date) : { rating: sh.rating, emotions: sh.emotions, free_text: sh.text.trim(), seeded: false };
        st.sheet = null; st.tab = 'today'; st.stacks.today = [{ v: 'journal', date: sh.date }]; break;
      case 'journal': push({ v: 'journal', date: el.dataset.d }); return;
      case 'reflect': var d = el.dataset.d;
        if (!st.entries[d].seeded) { st.offline[d] = true; break; }
        st.pending[d] = true; later(function () { delete st.pending[d]; st.revealed[d] = true; render(); }, 700); break;
      case 'session': push({ v: 'session' }); return;
      case 'example-session': st.sheet = null; st.tab = 'today'; st.stacks.today = [{ v: 'session' }]; break;
      case 'letter': push({ v: 'letter' }); return;
      case 'article': push({ v: 'article', id: el.dataset.id }); return;
      case 'push': push({ v: el.dataset.v }); return;
      case 'back': st.stacks[st.tab].pop(); break;
      case 'ex': st.openEx[el.dataset.k] = !st.openEx[el.dataset.k]; break;
      case 'toggle': st.toggles[el.dataset.k] = !st.toggles[el.dataset.k]; break;
      case 'play': togglePlay(el.dataset.src); return;
      default: return;
    }
    render();
  }
  document.addEventListener('click', function (e) { var el = e.target.closest('[data-act]'); if (el && !el.disabled) act(el.dataset.act, el); else if (e.target === sheetWrap) { st.sheet = null; renderSheet(); } });
  document.addEventListener('keydown', function (e) {
    var typing = /INPUT|TEXTAREA/.test(e.target.tagName);
    if ((e.key === 'Enter' || e.key === ' ') && e.target.getAttribute && e.target.getAttribute('role') === 'button') { e.preventDefault(); e.target.click(); return; }
    if (e.key === 'Escape') { if (st.sheet) { st.sheet = null; renderSheet(); } else if (window.parent !== window) { if (document.activeElement) document.activeElement.blur(); window.parent.postMessage({ type: 'omfavn-app', evt: 'release' }, '*'); } return; }
    if (typing || e.repeat || window.parent === window) return;
    if (['ArrowRight', 'ArrowLeft', 'PageDown', 'PageUp'].indexOf(e.key) >= 0) e.preventDefault();
    if (e.key === 'ArrowRight' || e.key === 'PageDown') window.parent.postMessage({ type: 'omfavn-app', evt: 'nav', dir: 'next' }, '*');
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') window.parent.postMessage({ type: 'omfavn-app', evt: 'nav', dir: 'prev' }, '*');
  });
  document.addEventListener('input', function (e) { if (e.target.id === 'ask-input') st.askDraft = e.target.value;
    if (e.target.id === 'entry-text' && st.sheet) { st.sheet.text = e.target.value; var s = $('save'); if (s) s.disabled = !st.sheet.text.trim(); } });
  document.addEventListener('submit', function (e) { e.preventDefault(); var inp = $('ask-input'), q = inp && inp.value.trim(); if (q) { st.asked.unshift(q); st.askDraft = ''; st.toTop = true; render(); var again = $('ask-input'); if (again) again.focus(); } });

  // ---------- fit + messaging
  function fit() {
    // Standalone on a phone: fill the screen. Inside the deck: a smaller logical phone, so text stays legible when scaled.
    var phone = $('phone'), w = window.innerWidth, h = window.innerHeight, embedded = window.parent !== window, bare = !embedded && w <= 500;
    var pw = embedded ? 340 : 390, ph = embedded ? 736 : 844;
    document.body.classList.toggle('bare', bare);
    if (bare) { phone.style.width = w + 'px'; phone.style.height = h + 'px'; phone.style.transform = ''; }
    else { phone.style.width = pw + 'px'; phone.style.height = ph + 'px'; phone.style.transform = 'scale(' + Math.min((h - 22) / ph, (w - 22) / pw, 1.3) + ')'; }
  }
  window.addEventListener('resize', fit);
  window.addEventListener('message', function (e) {
    if (e.source !== window.parent || !e.data || e.data.type !== 'omfavn-deck') return;
    if (e.data.cmd === 'beat' && [0, 1, 2, 3].indexOf(e.data.n) >= 0) setBeat(e.data.n);
    else if (e.data.cmd === 'deactivate') { stopAll(); render(); }
    else if (e.data.cmd === 'hello') { window.parent.postMessage({ type: 'omfavn-app', evt: 'ready' }, '*'); announce(true); }
  });

  fit();
  var m = /beat=(\d)/.exec(location.hash); setBeat(m ? +m[1] : 0);
  if (window.parent !== window) window.parent.postMessage({ type: 'omfavn-app', evt: 'ready' }, '*');
})();
