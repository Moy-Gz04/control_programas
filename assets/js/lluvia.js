/* ═══════════════════════════════════════════════════
   SBIS — Lluvia de flores de cempasúchil (fondo decorativo)
   Genera una cantidad moderada de flores muy pequeñas que caen
   de forma continua y aleatoria detrás del contenido de la
   página (ver .lluvia-flores / .flor-lluvia en css/styles.css,
   o el bloque equivalente dentro de login.html).

   Además, cada flor es "tocable": un click o toque la hace
   explotar en una pequeña ráfaga de chispas tipo fuegos
   artificiales (ver .chispa-fuego / .destello-fuego) y se repone
   una flor nueva de inmediato, para que la lluvia mantenga
   siempre la misma cantidad cayendo.
   ═══════════════════════════════════════════════════ */
(function () {
  var COLORES_CHISPA = ['#ff9d2f', '#ffc93c', '#ff6b3d', '#ffe066', '#c8a951', '#ff4d4d'];

  function prefiereMenosMovimiento() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function crearUnaFlor(contenedor) {
    var flor = document.createElement('div');
    flor.className = 'flor-lluvia';

    var tam       = (11 + Math.random() * 13).toFixed(0);         // 11–24px: flores muy pequeñas
    var izquierda = (Math.random() * 100).toFixed(1);              // 0–100% del ancho
    var duracion  = (13 + Math.random() * 11).toFixed(1);          // 13–24s: caída relativamente normal
    var retraso   = (Math.random() * duracion).toFixed(1);
    var deriva    = (Math.random() * 70 - 35).toFixed(0) + 'px';   // leve vaivén lateral
    var giro      = ((Math.random() < 0.5 ? -1 : 1) * (220 + Math.random() * 260)).toFixed(0) + 'deg';

    flor.style.width  = tam + 'px';
    flor.style.height = tam + 'px';
    flor.style.left   = izquierda + '%';
    flor.style.animationDuration = duracion + 's';
    flor.style.animationDelay    = '-' + retraso + 's'; // arranca a media caída, para que no se vea vacío al cargar
    flor.style.setProperty('--deriva', deriva);
    flor.style.setProperty('--giro-final', giro);

    contenedor.appendChild(flor);
    return flor;
  }

  function crearDestello(contenedor, cx, cy) {
    var destello = document.createElement('div');
    destello.className = 'destello-fuego';
    destello.style.left = cx + 'px';
    destello.style.top  = cy + 'px';
    contenedor.appendChild(destello);
    destello.addEventListener('animationend', function () { destello.remove(); });
    // Respaldo por si el navegador no dispara animationend (p.ej. pestaña en segundo plano)
    setTimeout(function () { destello.remove(); }, 500);
  }

  function crearChispas(contenedor, cx, cy) {
    var cantidad = 10 + Math.floor(Math.random() * 6); // 10–15 chispas: fuegos artificiales "en pequeño"
    for (var i = 0; i < cantidad; i++) {
      var chispa    = document.createElement('div');
      var angulo    = Math.random() * Math.PI * 2;
      var distancia = 24 + Math.random() * 36; // 24–60px de alcance
      var dx        = (Math.cos(angulo) * distancia).toFixed(1) + 'px';
      var dy        = (Math.sin(angulo) * distancia).toFixed(1) + 'px';
      var tam       = (4 + Math.random() * 4).toFixed(1);

      chispa.className = 'chispa-fuego';
      chispa.style.left       = cx + 'px';
      chispa.style.top        = cy + 'px';
      chispa.style.width      = tam + 'px';
      chispa.style.height     = tam + 'px';
      chispa.style.background = COLORES_CHISPA[Math.floor(Math.random() * COLORES_CHISPA.length)];
      chispa.style.setProperty('--dx', dx);
      chispa.style.setProperty('--dy', dy);
      chispa.style.animationDelay = (Math.random() * 0.06).toFixed(2) + 's';

      contenedor.appendChild(chispa);
      chispa.addEventListener('animationend', function () { this.remove(); });
      setTimeout((function (el) { return function () { el.remove(); }; })(chispa), 800);
    }
  }

  function explotarFlor(flor, contenedor) {
    if (flor.dataset.explotando === '1') return; // evita doble explosión con toques muy rápidos
    flor.dataset.explotando = '1';

    var rectFlor = flor.getBoundingClientRect();
    var rectCont = contenedor.getBoundingClientRect();
    var cx = rectFlor.left - rectCont.left + rectFlor.width  / 2;
    var cy = rectFlor.top  - rectCont.top  + rectFlor.height / 2;

    if (!prefiereMenosMovimiento()) {
      crearDestello(contenedor, cx, cy);
      crearChispas(contenedor, cx, cy);
    }

    // La flor tocada desaparece de inmediato (las chispas ya cubren
    // visualmente el "estallido") y se repone una nueva enseguida,
    // para que la lluvia mantenga siempre la misma cantidad cayendo.
    flor.style.animationPlayState = 'paused';
    flor.style.opacity = '0';
    flor.style.pointerEvents = 'none';
    setTimeout(function () {
      flor.remove();
      crearUnaFlor(contenedor);
    }, 60);
  }

  function crearLluviaDeFlores(idContenedor, cantidad) {
    var contenedor = document.getElementById(idContenedor);
    if (!contenedor) {
      contenedor = document.createElement('div');
      contenedor.id = idContenedor;
      contenedor.className = 'lluvia-flores';
      document.body.prepend(contenedor);
    }
    if (contenedor.dataset.pintado === '1') return; // evita duplicar si se llama más de una vez
    contenedor.dataset.pintado = '1';

    cantidad = cantidad || 17; // ni muchas ni pocas

    for (var i = 0; i < cantidad; i++) {
      crearUnaFlor(contenedor);
    }

    // Delegación de eventos: un solo listener detecta el click/toque
    // sobre cualquier flor, incluidas las que se van reponiendo.
    contenedor.addEventListener('click', function (e) {
      var flor = e.target.closest && e.target.closest('.flor-lluvia');
      if (flor && contenedor.contains(flor)) {
        explotarFlor(flor, contenedor);
      }
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    crearLluviaDeFlores('lluvia-flores', 17);
  });

  window.crearLluviaDeFlores = crearLluviaDeFlores;
})();