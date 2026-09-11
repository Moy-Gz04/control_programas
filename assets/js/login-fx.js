/**
 * Efectos visuales del login: entrada con GSAP + fondo 3D con Three.js.
 * Basado en el Design DNA de design/design-dna.json.
 *
 * REGLA DE ORO: la tarjeta de login (.login-card) NUNCA debe quedar
 * translúcida. Por eso esta animación solo mueve (translateY), nunca
 * toca la opacidad del contenido — así, sin importar en qué instante
 * caiga un screenshot o qué tan lento cargue el CDN, el texto y los
 * campos del formulario siempre son 100% legibles. El fade de entrada
 * ya lo cubre, de forma garantizada, el @keyframes modalIn de CSS.
 *
 * Todo esto es "progressive enhancement": si GSAP o Three.js no cargan
 * (CDN caído, red lenta), o el usuario prefiere menos movimiento, o la
 * pantalla es chica, el login se ve y funciona igual de bien.
 */
(function () {
  "use strict";

  var prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ── GSAP: pequeño deslizamiento de entrada, SIN tocar opacidad ──
  function animarEntrada() {
    if (typeof gsap === "undefined" || prefersReduced) return;
    try {
      gsap.from(".login-card", {
        y: 18,
        duration: 0.5,
        ease: "power3.out",
        clearProps: "transform", // al terminar, no deja ningun estilo inline pegado
      });
    } catch (e) {
      /* si algo falla, el CSS (@keyframes modalIn) ya resolvió la entrada */
    }
  }

  // ── Three.js: nube de puntos dorados/guinda flotando de fondo ──
  function iniciarFondo3D() {
    if (typeof THREE === "undefined") return;
    if (prefersReduced) return;
    if (window.innerWidth < 720) return; // evita el costo en pantallas chicas/móvil

    var canvas = document.getElementById("bg3d");
    if (!canvas) return;

    var renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true });
    } catch (e) {
      return; // WebGL no disponible: se queda el fondo CSS, sin error visible
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight);

    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(
      55,
      window.innerWidth / window.innerHeight,
      0.1,
      100
    );
    camera.position.z = 18;

    var COUNT = 220;
    var positions = new Float32Array(COUNT * 3);
    var colors = new Float32Array(COUNT * 3);
    var colorGold = new THREE.Color("#C8A951");
    var colorMaroon = new THREE.Color("#8C3358");

    for (var i = 0; i < COUNT; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 40;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 24;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 20;
      var c = Math.random() > 0.6 ? colorGold : colorMaroon;
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }

    var geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    var mat = new THREE.PointsMaterial({
      size: 0.16,
      vertexColors: true,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    });

    var puntos = new THREE.Points(geo, mat);
    scene.add(puntos);

    var visible = true;
    document.addEventListener("visibilitychange", function () {
      visible = document.visibilityState === "visible";
    });

    function tick() {
      requestAnimationFrame(tick);
      if (!visible) return;
      puntos.rotation.y += 0.0006;
      puntos.rotation.x += 0.0002;
      renderer.render(scene, camera);
    }
    tick();

    window.addEventListener("resize", function () {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  animarEntrada();
  iniciarFondo3D();
})();
