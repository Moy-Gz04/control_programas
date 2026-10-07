// =========================================================
// login-espacio.js
// Cielo de estrellas del login: puntos de distintos tamaños y brillo
// dibujados en un canvas que cubre la pantalla. Algunos titilan
// despacio (se respeta "reducir movimiento").
// =========================================================

(function () {
  const lienzo = document.getElementById('login-estrellas');
  if (!lienzo) return;
  const ctx = lienzo.getContext('2d');
  const quieto = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let estrellas = [], ancho = 0, alto = 0, cuadro = null;

  function crear() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    ancho = lienzo.clientWidth; alto = lienzo.clientHeight;
    lienzo.width = ancho * dpr; lienzo.height = alto * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.round(ancho * alto / 5200);
    estrellas = Array.from({ length: n }, () => ({
      x: Math.random() * ancho, y: Math.random() * alto,
      r: Math.random() < .08 ? 1.3 + Math.random() * 1.2 : .4 + Math.random() * .8,
      a: .25 + Math.random() * .65,
      fase: Math.random() * Math.PI * 2,
      vel: .4 + Math.random() * 1.2,
      dorada: Math.random() < .25
    }));
  }

  function pintar(t) {
    ctx.clearRect(0, 0, ancho, alto);
    for (const e of estrellas) {
      const brillo = quieto ? e.a : e.a * (.65 + .35 * Math.sin(t / 1000 * e.vel + e.fase));
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
      ctx.fillStyle = e.dorada ? `rgba(233, 205, 140, ${brillo})` : `rgba(235, 228, 220, ${brillo})`;
      ctx.fill();
      if (e.r > 1.3) {   // las grandes con un halo suave
        ctx.beginPath(); ctx.arc(e.x, e.y, e.r * 3.2, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(233, 205, 140, ${brillo * .12})`; ctx.fill();
      }
    }
  }

  function animar(t) {
    const login = document.querySelector('#pantalla-login, .login-eclipse');
    if (login && login.offsetParent !== null) {             // solo mientras el login está visible
      if (!ancho || lienzo.clientWidth !== ancho) crear();
      pintar(t);
    }
    cuadro = requestAnimationFrame(animar);
  }

  crear();
  if (quieto) pintar(0); else cuadro = requestAnimationFrame(animar);
  window.addEventListener('resize', () => { crear(); if (quieto) pintar(0); });
})();
