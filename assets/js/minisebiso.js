// =========================================================
// minisebiso.js
// MiniSEBISO (la mascota del login): sus ojos siguen al ratón o al dedo,
// con un tope para que no se salgan de la cara; si el puntero sale de la
// ventana vuelve a mirar de frente.
// =========================================================

(function () {
  const ojos = document.querySelectorAll('.minisebiso .ms-ojo-mov');
  if (!ojos.length) return;
  const centrar = () => ojos.forEach(o => { o.style.setProperty('--dx', '0px'); o.style.setProperty('--dy', '0px'); });
  window.addEventListener('pointermove', (e) => {
    ojos.forEach(o => {
      const r = o.getBoundingClientRect();
      if (!r.width) return;
      const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      const dist = Math.hypot(dx, dy) || 1;
      const fuerza = Math.min(1, dist / 220);
      o.style.setProperty('--dx', (dx / dist * r.width * .55 * fuerza).toFixed(1) + 'px');
      o.style.setProperty('--dy', (dy / dist * r.height * .32 * fuerza).toFixed(1) + 'px');
    });
  });
  document.documentElement.addEventListener('mouseleave', centrar);
})();

// Al tocarlo saluda: brinca y muestra una burbuja sobre su cabeza unos segundos
(function () {
  const ms = document.querySelector('.minisebiso');
  if (!ms) return;
  let temporizador = null;
  function saludar() {
    ms.classList.remove('saltando'); void ms.offsetWidth; ms.classList.add('saltando');
    ms.classList.add('hablando');
    clearTimeout(temporizador);
    temporizador = setTimeout(() => ms.classList.remove('hablando'), 4500);
  }
  ms.addEventListener('click', saludar);
  ms.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); saludar(); } });
  ms.addEventListener('animationend', (e) => { if (e.animationName === 'msSalto') ms.classList.remove('saltando'); });
})();
