/**
 * Efectos visuales del login: entrada con GSAP + fondo 3D con Three.js.
 * Basado en el Design DNA extraído en design/design-dna.json.
 *
 * Es "progressive enhancement" puro: si GSAP o Three.js no cargan (CDN
 * caído, red lenta), o el usuario prefiere menos movimiento, o la
 * pantalla es chica, el login se ve y funciona igual de bien gracias al
 * CSS base (fondo con patrón + @keyframes modalIn ya en styles.css).
 */
(function () {
  "use strict";

  var prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ── GSAP: entrada escalonada de la tarjeta de login ──
  function animarEntrada() {
    if (typeof gsap === "undefined") return;

    var tl = gsap.timeline({ defaults: { ease: "power3.out" } });
    tl.from(".login-card", { y: 24, opacity: 0, duration: 0.6 })
      .from(
        ".login-head .brand-logo, .login-head h1, .login-head p",
        { y: 10, opacity: 0, duration: 0.4, stagger: 0.08 },
        "-=0.35"
      )
      .from(
        ".login-body .field",
        { y: 12, opacity: 0, duration: 0.35, stagger: 0.08 },
        "-=0.2"
      )
      .from(".login-body .btn-block", { y: 12, opacity: 0, duration: 0.35 }, "-=0.15")
      .from(".login-footer-note", { opacity: 0, duration: 0.4 }, "-=0.1");
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

    var COUNT = 260;
    var positions = new Float32Array(COUNT * 3);
    var colors = new Float32Array(COUNT * 3);
    var colorGold = new THREE.Color("#C9A84E");
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
      size: 0.18,
      vertexColors: true,
      transparent: true,
      opacity: 0.55,
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
      puntos.rotation.y += 0.0007;
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
