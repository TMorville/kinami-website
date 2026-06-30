const slides = [...document.querySelectorAll('.slide')];
const bar = document.getElementById('bar');
const pad = n => String(n).padStart(2, '0');
const totalStr = pad(slides.length);
let i = 0;

// Inject per-slide number "0N / 0T" top-left of every slide.
slides.forEach((s, k) => {
  const num = document.createElement('div');
  num.className = 'slide-num';
  num.textContent = pad(k + 1) + ' / ' + totalStr;
  s.appendChild(num);
});

// --- Slide 5: product video plays; explainer reveals on slide-enter -------
const productSlide = document.getElementById('product');
const productVideo = productSlide ? productSlide.querySelector('.bg') : null;
const productExplainer = productSlide ? productSlide.querySelector('.product-explainer') : null;

function enterProduct() {
  if (!productVideo || !productExplainer) return;
  productExplainer.classList.add('show');
  try {
    productVideo.currentTime = 0;
    const p = productVideo.play();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch (e) {}
}

function leaveProduct() {
  if (!productVideo) return;
  try { productVideo.pause(); } catch (e) {}
  if (productExplainer) productExplainer.classList.remove('show');
}

function show(n) {
  const prev = i;
  i = Math.max(0, Math.min(slides.length - 1, n));
  slides.forEach((s, k) => s.classList.toggle('active', k === i));
  bar.style.width = ((i + 1) / slides.length * 100) + '%';

  if (productSlide) {
    if (slides[i] === productSlide) enterProduct();
    else if (slides[prev] === productSlide) leaveProduct();
  }
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); show(i + 1); }
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); show(i - 1); }
  else if (e.key === 'Home') show(0);
  else if (e.key === 'End') show(slides.length - 1);
});

show(0);
