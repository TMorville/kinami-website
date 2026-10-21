const slides = [...document.querySelectorAll('.slide')];
let i = 0;

// Put the page number "N / T" at the right end of every slide's top row.
slides.forEach((s, k) => {
  let row = s.querySelector('.meta');
  if (!row) {
    row = document.createElement('header');
    row.className = 'meta';
    s.appendChild(row);
  }
  const pg = document.createElement('span');
  pg.className = 'pg';
  pg.textContent = (k + 1) + ' / ' + slides.length;
  row.appendChild(pg);
});

// The cover film plays only while the cover shows.
const coverVideo = document.querySelector('#cover video');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

function show(n) {
  i = Math.max(0, Math.min(slides.length - 1, n));
  slides.forEach((s, k) => {
    s.classList.toggle('active', k === i);
    s.setAttribute('aria-hidden', k === i ? 'false' : 'true');
  });
  slides[i].scrollTop = 0;
  // threat-map.js puts its incident tooltip on <body> and hides it only on the
  // next map interaction, so a tap then a swipe would carry it onto this slide.
  const tip = document.querySelector('.threat-tooltip');
  if (tip) tip.style.display = 'none';
  if (coverVideo && !reduceMotion) {
    try {
      if (i === 0) { const p = coverVideo.play(); if (p && p.catch) p.catch(() => {}); }
      else coverVideo.pause();
    } catch (e) {}
  }
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); show(i + 1); }
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); show(i - 1); }
  else if (e.key === 'Home') show(0);
  else if (e.key === 'End') show(slides.length - 1);
});

// Tap or click: the right two thirds go forward, the left third goes back.
// Links and text selections keep their own behaviour. On the incident map a
// click navigates too, except on a marker: threat-map.js shows its tooltip on
// hover or on a tap that hits a marker, so a visible tooltip means one was hit.
let swiped = false;
function onMarker(e) {
  if (!e.target.closest('canvas')) return false;
  const tt = document.querySelector('.threat-tooltip');
  return !!tt && tt.style.display !== 'none';
}
document.addEventListener('click', (e) => {
  if (swiped) { swiped = false; return; }
  if (e.target.closest('a, button, input, video[controls]') || onMarker(e)) return;
  const sel = window.getSelection && window.getSelection();
  if (sel && String(sel).length > 0) return;
  show(e.clientX < window.innerWidth / 3 ? i - 1 : i + 1);
});

// Horizontal swipe on touch screens. A vertical drag scrolls the slide.
let x0 = null, y0 = null;
document.addEventListener('touchstart', (e) => {
  if (e.touches.length !== 1) { x0 = null; return; }
  x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
}, { passive: true });
document.addEventListener('touchend', (e) => {
  if (x0 === null) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - x0, dy = t.clientY - y0;
  x0 = null;
  if (Math.abs(dx) > 48 && Math.abs(dx) > 1.5 * Math.abs(dy)) {
    swiped = true;
    setTimeout(() => { swiped = false; }, 400);
    show(dx < 0 ? i + 1 : i - 1);
  }
}, { passive: true });

show(0);
