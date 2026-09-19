const slides = [...document.querySelectorAll('.slide')];
const bar = document.getElementById('bar');
const pad = n => String(n).padStart(2, '0');
const totalStr = pad(slides.length);
let i = 0;

slides.forEach((s, k) => {
  const num = document.createElement('div');
  num.className = 'slide-num';
  num.textContent = pad(k + 1) + ' / ' + totalStr;
  s.appendChild(num);
  s.tabIndex = -1;
});

// Below 900px the CSS lays the slides out as one scrolling column (reading mode): every slide
// stays active and nothing advances. Above it, one slide is shown at a time (presentation mode).
const reading = window.matchMedia('(max-width: 900px)');

function show(n) {
  i = Math.max(0, Math.min(slides.length - 1, n));
  if (reading.matches) { slides.forEach(s => { s.classList.add('active'); s.inert = false; }); if (i > 0) slides[i].scrollIntoView(); return; }
  slides.forEach((s, k) => { s.classList.toggle('active', k === i); s.inert = k !== i; });
  slides[i].focus({ preventScroll: true }); // hands keyboard and screen-reader focus to the new slide
  bar.style.width = ((i + 1) / slides.length * 100) + '%';
  if (history.replaceState) history.replaceState(null, '', '#' + (i + 1));
}
reading.addEventListener('change', () => show(i));

// Phones get a one-tap notice over slide 1 before the scrolling page.
const deskNote = document.getElementById('desk-note');
if (deskNote && reading.matches) {
  const deckEl = document.querySelector('.deck');
  deskNote.classList.add('on'); deckEl.inert = true; // nothing behind the notice is reachable until it is dismissed
  document.getElementById('desk-note-go').focus();
  const dismiss = () => { deskNote.classList.remove('on'); deckEl.inert = false; };
  deskNote.addEventListener('click', dismiss);
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && deskNote.classList.contains('on')) dismiss(); });
}

window.addEventListener('keydown', (e) => {
  if (reading.matches) return;
  // Space and Enter belong to a focused control; typing belongs to the field.
  const t = e.target;
  if (t && t.closest && (t.closest('input, textarea') || (e.key === ' ' && t.closest('button, a')))) return;
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); show(i + 1); }
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); show(i - 1); }
  else if (e.key === 'Home') show(0);
  else if (e.key === 'End') show(slides.length - 1);
});
window.addEventListener('click', (e) => { if (reading.matches || e.target.closest('a, button')) return; show(i + 1); });

const start = parseInt(location.hash.slice(1), 10);
show(Number.isFinite(start) && start > 0 ? start - 1 : 0);

// --- Demo slide: the enso plays a real clip; transcript and pitch reveal in sync; then Oline ---
(function () {
  const slide = document.getElementById('demo');
  if (!slide) return;
  const audio = document.getElementById('demo-audio');
  const btn = document.getElementById('demo-play');
  const ink = document.getElementById('demo-ink');
  const tEl = document.getElementById('demo-t');
  const cta = document.getElementById('demo-cta');
  const linesEl = document.getElementById('demo-lines');
  const ol = document.getElementById('demo-ol');
  const steps = [...slide.querySelectorAll('#demo-pipe li')];
  // The pipeline line lights up with the slide: the columns show steps 1 to 4 while the clip plays, Oline's panel is step 5.
  const lightSteps = (stage) => steps.forEach(li => li.classList.toggle('on', stage === 'end' || (stage === 'play' && li.dataset.at === 'play')));
  let segs = [], olData = null;
  let readAll = false; // set by "Read it now": timed painting stays off until the clip plays again
  try { segs = JSON.parse(document.getElementById('demo-segments').textContent); } catch (e) { return; }
  try { olData = JSON.parse(document.getElementById('demo-oline').textContent); } catch (e) {}
  const DUR = 40.5;
  const parents = (olData && olData.parents) || ['adult'];
  const isParent = w => parents.includes(String(w).toLowerCase());
  // Pitch axis: 80 Hz at the left edge, 460 Hz at the right, log scale (pitch is heard in ratios).
  const LO = Math.log(80), HI = Math.log(460);
  const px = hz => Math.max(0, Math.min(100, (Math.log(hz) - LO) / (HI - LO) * 100));

  const lines = segs.map(s => {
    const d = document.createElement('div');
    d.className = 'line';
    const cls = isParent(s.who) ? ' parent' : '';
    const who = document.createElement('div'); who.className = 'who' + cls; who.textContent = s.who;
    const t = document.createElement('div'); t.className = 't'; t.textContent = s.text;
    const pt = document.createElement('div'); pt.className = 'pt';
    if (s.pitch) { const u = document.createElement('u'); u.className = cls.trim(); u.style.left = px(s.pitch) + '%'; u.title = Math.round(s.pitch) + ' Hz'; pt.appendChild(u); }
    d.append(who, t, pt); linesEl.appendChild(d);
    return d;
  });

  if (olData && olData.title) {
    document.getElementById('demo-ol-title').textContent = olData.title;
    const pull = document.getElementById('demo-ol-pull');
    if (olData.pull) pull.textContent = olData.pull; else pull.style.display = 'none';
    const body = document.getElementById('demo-ol-body');
    (olData.reflection || '').split(/\n\n+/).forEach(par => { const p = document.createElement('p'); p.textContent = par; body.appendChild(p); });
  }

  const left = t => { const r = Math.max(0, Math.ceil(DUR - 0.5 - t)); return '0:' + String(r).padStart(2, '0'); };
  function paint() {
    if (readAll) return;
    const t = audio.currentTime;
    tEl.textContent = left(t);
    ink.style.strokeDashoffset = String(100 - Math.min(1, t / (DUR - 0.5)) * 100);
    segs.forEach((s, k) => { lines[k].classList.toggle('on', t >= s.start - 0.05); lines[k].classList.toggle('now', t >= s.start - 0.05 && t < s.end + 0.3); });
  }
  function reset() {
    readAll = false;
    try { audio.pause(); audio.currentTime = 0; } catch (e) {}
    ol.classList.remove('on'); cta.textContent = 'Play'; btn.setAttribute('aria-label', 'Play the recording'); btn.classList.add('idle');
    lines.forEach(l => l.classList.remove('on', 'now')); ink.style.strokeDashoffset = '100'; tEl.textContent = '0:40'; lightSteps(null);
  }
  audio.addEventListener('timeupdate', paint);
  // The ring pulses until the clip first plays, so the enso reads as a play button.
  audio.addEventListener('play', () => { readAll = false; btn.classList.remove('idle'); lightSteps('play'); cta.textContent = 'Pause'; btn.setAttribute('aria-label', 'Pause the recording'); });
  // reset() rewinds before the async pause event lands, so a rewound clip keeps "Play".
  audio.addEventListener('pause', () => { if (!audio.ended && audio.currentTime > 0) { cta.textContent = 'Resume'; btn.setAttribute('aria-label', 'Resume the recording'); } });
  // "Read it now": the transcript and the reply without playing the clip. Playing afterwards inks it again in time.
  document.getElementById('demo-read').addEventListener('click', (e) => {
    e.stopPropagation(); readAll = true; audio.pause();
    lines.forEach(l => { l.classList.add('on'); l.classList.remove('now'); }); ol.classList.add('on'); lightSteps('end');
  });
  audio.addEventListener('ended', () => { paint(); lines.forEach(l => l.classList.remove('now')); cta.textContent = 'Again'; btn.setAttribute('aria-label', 'Play the recording again'); ol.classList.add('on'); lightSteps('end'); });
  // If the clip cannot play (missing file, codec, blocked), show the transcript and the reflection anyway.
  function noAudio() { btn.classList.remove('idle'); lines.forEach(l => { l.classList.add('on'); l.classList.remove('now'); }); ol.classList.add('on'); lightSteps('end'); cta.textContent = 'No audio'; tEl.textContent = '0:40'; }
  audio.addEventListener('error', noAudio);
  function toggle() { if (audio.ended) reset(); if (audio.paused) { const p = audio.play(); if (p && p.catch) p.catch(noAudio); } else audio.pause(); }
  btn.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
  slide.addEventListener('click', (e) => { e.stopPropagation(); }); // clicks on this slide do not advance
  window.addEventListener('keydown', (e) => { if (slide.classList.contains('active') && (e.key === 'p' || e.key === 'P')) { e.preventDefault(); toggle(); } });
  new MutationObserver(() => { if (!slide.classList.contains('active')) reset(); }).observe(slide, { attributes: true, attributeFilter: ['class'] });
})();

// --- Product slide: the text beside the phone follows the screen the viewer opens in the web demo ---
(function () {
  const slide = document.getElementById('app');
  const frame = document.getElementById('app-frame');
  if (!slide || !frame) return;
  const now = slide.querySelector('.now');
  const [label, title, text] = ['.now-label', '.now-title', '.now-text'].map(s => now.querySelector(s));
  const excerpt = now.querySelector('.excerpt'), exLabel = excerpt.querySelector('.ex-label'), exText = excerpt.querySelector('.ex-text');
  const seed = window.OMFAVN_SEED || null;
  const ex = (seed && seed.excerpts) || {};
  const firstEntry = seed && seed.journal && seed.journal[0] ? seed.journal[0].date : null;
  // One label, one headline, at most one sentence per screen. Quotes are verbatim from the seed (build_app_seed.py checks them).
  const SCREENS = {
    today: ['Today', 'A question only this family gets.', 'Oline picks one child and writes from that child\u2019s profile, the week\u2019s entries and the recordings.'],
    journal: ['The journal', 'A moment in three steps.', 'How the day felt, what was in it, and a few lines. She reads all three.'],
    entry: ['The journal', 'The moment is saved.', 'Oline reads it beside the recordings and the rest of the week. She is offline in this demo for text you type.'],
    reflection: ['Oline writes back', 'A reply to this moment.', 'She names the child, works from what he did this week and points to one article. That is the whole reply, with no general advice in it.'],
    record: ['Record', 'Or record the moment itself.', 'Up to thirty minutes at the table. Each voice is matched to a family member, so she knows who said what. Recording is off in this demo.'],
    session: ['A recording', 'What a recording adds.', 'The words, who spoke, and how it sounded. All of it is read together with the journal.'],
    oline: ['Ask Oline', 'A question gets one answer.', 'She answers from this family\u2019s own entries, recordings and child profiles. General advice is not in it.'],
    letter: ['Sunday', 'The week in one letter.', 'Oline writes it from the week just passed: what went well, one thing to try, and a question to sit with.'],
    grow: ['Grow', 'A library on child development.', '25 articles, every one narrated in the app (four play in this demo). Oline knows them all and points to the one that fits the entry she just read.'],
    article: ['Grow', 'Read it, or listen.', 'When Oline writes back, the article she points to comes from this library.'],
    settings: ['Settings', 'One household, both parents.', 'The family and their profiles, reminders, and the subscription.'],
    family: ['Settings', 'Each child’s profile grows.','Every entry and every recording adds to what Oline knows about that child. Each member enrols a voice, so Oline can tell who spoke in a recording.'],
    sub: ['Settings', 'One subscription per household.', 'One plan covers both parents.'],
    notif: ['Settings', 'Reminders.', 'A nudge to write or record.'],
    about: ['Settings', 'What is real here.', 'The household is invented. Oline\u2019s words and the dinner recording are real.'],
  };
  let ready = false, shown = '';
  function follow(name) {
    const key = String(name || '');
    const [base, date] = key.split(':');
    const s = SCREENS[base]; if (!s || key === shown) return;
    shown = key;
    const quote = base === 'reflection' && date === firstEntry && ex.reflection ? ['What Oline wrote back', ex.reflection]
      : base === 'journal' && ex.entry ? ['What one father wrote on Monday', ex.entry] : null;
    now.classList.add('swap');
    setTimeout(() => {
      label.textContent = s[0]; title.textContent = s[1]; text.textContent = s[2];
      excerpt.hidden = !quote; if (quote) { exLabel.textContent = quote[0]; exText.textContent = quote[1]; }
      now.classList.remove('swap');
    }, 180);
  }
  const send = msg => { if (ready && frame.contentWindow) frame.contentWindow.postMessage(Object.assign({ type: 'omfavn-deck' }, msg), '*'); };
  if (!seed) { label.textContent = 'Demo data missing'; title.textContent = 'deck/app/seed.js did not load.'; text.textContent = 'Run deck/tools/build_app_seed.py.'; excerpt.hidden = true; }
  else follow('today');
  slide.addEventListener('click', (e) => { e.stopPropagation(); }); // clicks on this slide do not advance
  // The demo posts 'ready' when it loads. If that message was lost (load order), 'hello' asks for it again.
  const hello = () => { try { frame.contentWindow.postMessage({ type: 'omfavn-deck', cmd: 'hello' }, '*'); } catch (e) {} };
  frame.addEventListener('load', hello); hello();
  window.addEventListener('message', (e) => {
    if (e.source !== frame.contentWindow || !e.data || e.data.type !== 'omfavn-app') return;
    if (e.data.evt === 'ready') { ready = true; return; } // the demo opens on the whole example week by itself
    if (e.data.evt === 'screen') { follow(e.data.name); return; }
    if (!slide.classList.contains('active')) return;
    if (e.data.evt === 'nav' && (e.data.dir === 'next' || e.data.dir === 'prev')) { frame.blur(); window.focus(); show(i + (e.data.dir === 'next' ? 1 : -1)); }
    else if (e.data.evt === 'release') { frame.blur(); window.focus(); }
  });
  // Leaving pauses the demo. Coming back resumes where the viewer was.
  // Reading mode hides the iframe with CSS while the slide stays active, so stop it explicitly.
  window.matchMedia('(max-width: 900px)').addEventListener('change', (e) => { if (e.matches) send({ cmd: 'deactivate' }); });
  new MutationObserver(() => {
    if (!slide.classList.contains('active')) { send({ cmd: 'deactivate' }); if (document.activeElement === frame) frame.blur(); }
  }).observe(slide, { attributes: true, attributeFilter: ['class'] });
})();
