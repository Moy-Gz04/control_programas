/* =========================================================================
   Carga con la mascota (como en Contratos y Correspondencia)
   Carga.html('Cargando programas…') devuelve el bloque: la mascota
   "trabajando", una barra que avanza sola (sin segundos: se acerca al final
   y se completa cuando llega la información, porque el bloque se reemplaza)
   y mensajes que van cambiando mientras espera. Si el servidor está
   despertando (Render), los mensajes lo explican sin cuenta regresiva.
   ========================================================================= */
(function(){
  const MASCOTA = `
    <div class="minisebiso carga-mascota" aria-hidden="true">
      <div class="ms-cuerpo">
        <span class="ms-ojo-mov izq"><span class="ms-ojo"></span></span>
        <span class="ms-ojo-mov der"><span class="ms-ojo"></span></span>
      </div>
      <div class="ms-estrella"></div>
    </div>`;
  const MENSAJES = {
    programas: ['Reuniendo los programas…', 'Sumando montos y dispersiones…', 'Acomodando las tarjetas…', 'Casi listo…'],
    programa: ['Abriendo el programa…', 'Revisando solicitudes y pagos…', 'Preparando la gráfica del presupuesto…', 'Casi listo…'],
    servidor: ['Despertando el servidor…', 'El sistema estaba en reposo, ya casi responde…', 'Preparando tu sesión…', 'Un momento más…'],
  };

  function html(texto, tipo){
    const msgs = MENSAJES[tipo] || MENSAJES.programas;
    return `
      <div class="carga" role="status" aria-live="polite">
        ${MASCOTA}
        <div class="carga-titulo">${texto}</div>
        <div class="carga-barra"><span></span></div>
        <div class="carga-msg" data-msgs='${JSON.stringify(msgs).replace(/'/g, '&#39;')}'>${msgs[0]}</div>
      </div>`;
  }

  // Los mensajes cambian cada ~2.8 s en cualquier bloque de carga visible
  setInterval(()=>{
    document.querySelectorAll('.carga-msg[data-msgs]').forEach(el=>{
      let lista; try { lista = JSON.parse(el.dataset.msgs); } catch(e){ return; }
      const i = (Number(el.dataset.i || 0) + 1) % lista.length;
      el.dataset.i = i;
      el.classList.remove('carga-msg-entra'); void el.offsetWidth;
      el.textContent = lista[i];
      el.classList.add('carga-msg-entra');
    });
  }, 2800);

  window.Carga = { html, MASCOTA };
})();
