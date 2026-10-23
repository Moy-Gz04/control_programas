/* =========================================================================
   VIEW: REPORTES
   Genera reportes en PDF sobre la hoja membretada (FORMATO HOJA MEMBRETADA:
   logo Bienestar + escudo arriba a la derecha, domicilio abajo a la derecha,
   tamaño carta con sus mismos márgenes). Puede ser general (todos los
   programas) o de uno o varios programas elegidos por el usuario.
   Lleva fecha, título, subtítulos, redacción y la información en tablas.
   Las cifras salen de las mismas funciones que el detalle y el Resumen
   (totalAutorizadoNeto, totalComprometido, totalPagado, …) de app.js.
   ========================================================================= */

const REP = {
  tipo: 'general',            // 'general' | 'seleccion'
  seleccion: new Set(),
  urlPdf: null,
};

/* ---- medidas de la hoja membretada (mm, carta) ---- */
const HOJA = {
  w: 215.9, h: 279.4,
  izq: 25, der: 23.4, sup: 38, inf: 34,          // área de texto (debajo del logo, arriba del domicilio)
  logo: { x: 107.1, y: 12.4, w: 92.9, h: 16.4 },  // posición del logo en el .docx original
};
const GUINDA = [95, 33, 50], DORADO = [169, 130, 76], GRIS = [107, 85, 99], TINTA = [32, 16, 23];
const DOMICILIO = [
  'Calle 16 de enero #309 Col. Revolución',
  'Lt. y Mza.: casa de Gobierno',
  'Pachuca de Soto, Hgo. C.P.: 42060',
  'Tel. (771) 71.7.60.00 Ext. 4356',
  'www.hidalgo.gob.mx',
];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const fechaLarga = (iso) => { const [a, m, d] = iso.split('-').map(Number); return `${d} de ${MESES[m - 1]} de ${a}`; };
const fechaCorta = (v) => { if(!v) return '—'; const d = new Date(v); return isNaN(d) ? '—' : d.toLocaleDateString('es-MX', { timeZone: 'America/Mexico_City', day: '2-digit', month: '2-digit', year: 'numeric' }); };
const hoyISO = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
const fmtPesos = (n) => '$' + Math.round(Number(n || 0)).toLocaleString('es-MX');   // sin centavos, para tablas anchas
const pctTxt = (v, t) => (t > 0 ? (v / t * 100) : 0).toFixed(1) + '%';

/* ---------- pantalla ---------- */
function renderReportes(){
  const el = document.getElementById('view-reportes');
  const progs = state.programs.slice().sort((a, b) => totalAutorizadoNeto(b) - totalAutorizadoNeto(a));
  el.innerHTML = `
    <div class="pipeline-card pipeline-card-chart pipeline-flujo rep-card">
      <div class="pipeline-eyebrow">Nuevo reporte</div>
      <div class="rep-form">
        <div class="rep-campo">
          <span class="rep-label">¿De qué programas?</span>
          <div class="rep-tipos" role="radiogroup">
            <button type="button" class="rep-tipo" data-tipo="general" role="radio" aria-checked="${REP.tipo === 'general'}"><b>General</b><span>Todos los programas (${progs.length})</span></button>
            <button type="button" class="rep-tipo" data-tipo="seleccion" role="radio" aria-checked="${REP.tipo === 'seleccion'}"><b>Uno o varios</b><span>Elige los programas</span></button>
          </div>
        </div>
        <div class="rep-campo rep-lista-campo" id="repListaCampo" ${REP.tipo === 'seleccion' ? '' : 'hidden'}>
          <span class="rep-label">Programas <button type="button" class="rep-mini" id="repTodos">Todos</button><button type="button" class="rep-mini" id="repNinguno">Ninguno</button></span>
          <div class="rep-lista">
            ${progs.map(p => `
              <label class="rep-prog"><input type="checkbox" value="${p.id}" ${REP.seleccion.has(p.id) ? 'checked' : ''}>
                <span><b>${esc(p.clave || '')}</b> ${esc(p.nombre)}</span><em>${fmtMoneyCompact(totalAutorizadoNeto(p))}</em></label>`).join('')}
          </div>
        </div>
        <div class="rep-fila">
          <label class="rep-campo rep-crece"><span class="rep-label">Título</span><input type="text" id="repTitulo" maxlength="140"></label>
          <label class="rep-campo"><span class="rep-label">Fecha</span><input type="date" id="repFecha" value="${hoyISO()}"></label>
        </div>
        <div class="rep-campo">
          <span class="rep-label">Secciones</span>
          <div class="rep-secciones">
            <label><input type="checkbox" id="repSecResumen" checked> Resumen ejecutivo</label>
            <label><input type="checkbox" id="repSecTabla" checked> Avance por programa (tabla)</label>
            <label><input type="checkbox" id="repSecDistrib" checked> Distribución del autorizado</label>
            <label><input type="checkbox" id="repSecDetalle"> Detalle de cada programa</label>
            <label><input type="checkbox" id="repSecTramites"> Trámites ante Hacienda</label>
          </div>
        </div>
        <div class="rep-acciones">
          <span class="rep-aviso" id="repAviso" role="status"></span>
          <button type="button" class="btn btn-primary" id="repGenerar"><i class="ti ti-file-type-pdf"></i> Generar reporte</button>
        </div>
      </div>
    </div>
    <div class="pipeline-card pipeline-card-chart pipeline-flujo rep-vista" id="repVista" hidden>
      <div class="pipeline-eyebrow">Vista previa<span class="rep-vista-acc">
        <button type="button" class="table-toggle" id="repImprimir"><i class="ti ti-printer"></i> Imprimir</button>
        <button type="button" class="btn btn-gold btn-sm" id="repDescargar"><i class="ti ti-download"></i> Descargar PDF</button>
      </span></div>
      <iframe id="repFrame" title="Vista previa del reporte"></iframe>
    </div>`;

  const titulo = el.querySelector('#repTitulo');
  const sugerirTitulo = () => {
    const sel = progs.filter(p => REP.seleccion.has(p.id));
    titulo.value = REP.tipo === 'general' ? 'Reporte general de avance presupuestal de los programas sociales'
      : sel.length === 1 ? `Reporte del ${sel[0].nombre}`
      : 'Reporte de avance presupuestal de programas seleccionados';
  };
  const ajustarSecciones = () => {
    // en uno o varios programas el detalle y los trámites vienen marcados; en el general, no
    el.querySelector('#repSecDetalle').checked = REP.tipo === 'seleccion';
    el.querySelector('#repSecTramites').checked = REP.tipo === 'seleccion';
  };
  sugerirTitulo(); ajustarSecciones();

  el.querySelectorAll('.rep-tipo').forEach(b => b.addEventListener('click', () => {
    REP.tipo = b.dataset.tipo;
    el.querySelectorAll('.rep-tipo').forEach(x => x.setAttribute('aria-checked', String(x === b)));
    el.querySelector('#repListaCampo').hidden = REP.tipo !== 'seleccion';
    sugerirTitulo(); ajustarSecciones();
  }));
  el.querySelectorAll('.rep-prog input').forEach(c => c.addEventListener('change', () => {
    c.checked ? REP.seleccion.add(Number(c.value)) : REP.seleccion.delete(Number(c.value));
    sugerirTitulo();
  }));
  const marcar = (v) => { el.querySelectorAll('.rep-prog input').forEach(c => { c.checked = v; v ? REP.seleccion.add(Number(c.value)) : REP.seleccion.delete(Number(c.value)); }); sugerirTitulo(); };
  el.querySelector('#repTodos').addEventListener('click', () => marcar(true));
  el.querySelector('#repNinguno').addEventListener('click', () => marcar(false));
  el.querySelector('#repGenerar').addEventListener('click', (e) => generarReporte(e.currentTarget));
  el.querySelector('#repDescargar').addEventListener('click', () => {
    if(!REP.urlPdf) return;
    const a = document.createElement('a'); a.href = REP.urlPdf; a.download = REP.nombre || 'Reporte.pdf'; document.body.appendChild(a); a.click(); a.remove();
  });
  el.querySelector('#repImprimir').addEventListener('click', () => { const f = el.querySelector('#repFrame'); try { f.contentWindow.focus(); f.contentWindow.print(); } catch { window.open(REP.urlPdf, '_blank'); } });
  animateViewIn(el);
}

/* ---------- generar ---------- */
let LOGO_MEMBRETE = null;
async function logoMembrete(){
  if(LOGO_MEMBRETE) return LOGO_MEMBRETE;
  const blob = await (await fetch('assets/img/membrete-bienestar.png')).blob();
  LOGO_MEMBRETE = await new Promise((ok, mal) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = mal; r.readAsDataURL(blob); });
  return LOGO_MEMBRETE;
}

async function generarReporte(btn){
  const el = document.getElementById('view-reportes');
  const aviso = el.querySelector('#repAviso');
  const ids = REP.tipo === 'general' ? state.programs.map(p => p.id) : [...REP.seleccion];
  if(!ids.length){ aviso.textContent = 'Elige al menos un programa.'; return; }
  if(!window.jspdf || !window.jspdf.jsPDF){ aviso.textContent = 'No se pudo cargar el generador de PDF. Revisa tu conexión y recarga la página.'; return; }
  const opciones = {
    titulo: el.querySelector('#repTitulo').value.trim() || 'Reporte de programas sociales',
    fecha: el.querySelector('#repFecha').value || hoyISO(),
    resumen: el.querySelector('#repSecResumen').checked,
    tabla: el.querySelector('#repSecTabla').checked,
    distrib: el.querySelector('#repSecDistrib').checked,
    detalle: el.querySelector('#repSecDetalle').checked,
    tramites: el.querySelector('#repSecTramites').checked,
  };
  aviso.textContent = '';
  await withLoading(btn, async () => {
    try {
      // el detalle y los trámites necesitan la información completa de cada programa
      let programas = state.programs.filter(p => ids.includes(p.id));
      if(opciones.detalle || opciones.tramites){
        programas = await Promise.all(programas.map(p => (p.solicitudesHacienda ? p : refreshOneProgram(p.id))));
      }
      programas.sort((a, b) => totalAutorizadoNeto(b) - totalAutorizadoNeto(a));
      const pdf = construirPdf(programas, opciones, await logoMembrete());
      if(REP.urlPdf) URL.revokeObjectURL(REP.urlPdf);
      REP.urlPdf = URL.createObjectURL(pdf.output('blob'));
      REP.nombre = `Reporte_Programas_${opciones.fecha}.pdf`;
      const vista = el.querySelector('#repVista');
      vista.hidden = false;
      el.querySelector('#repFrame').src = REP.urlPdf + '#toolbar=0&navpanes=0&view=FitH';   // sin la barra del visor de Chrome
      vista.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch(err){
      console.error('[reportes]', err);
      aviso.textContent = 'No se pudo generar el reporte: ' + (err.message || 'error desconocido');
    }
  }, 'Generando…');
}

/* ---------- PDF ---------- */
function construirPdf(programas, op, logo){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'letter' });
  const anchoTexto = HOJA.w - HOJA.izq - HOJA.der;
  const limite = HOJA.h - HOJA.inf;
  let y = HOJA.sup;

  const conMembrete = new Set();   // páginas que ya tienen el membrete (una sola vez por hoja)
  const membrete = () => {
    const pg = doc.getCurrentPageInfo().pageNumber;
    if(conMembrete.has(pg)) return;
    conMembrete.add(pg);
    doc.addImage(logo, 'PNG', HOJA.logo.x, HOJA.logo.y, HOJA.logo.w, HOJA.logo.h);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(60, 60, 60);
    DOMICILIO.forEach((l, i) => doc.text(l, HOJA.w - HOJA.der, HOJA.h - 22 + i * 3.4, { align: 'right' }));
  };
  const nuevaPagina = () => { doc.addPage(); membrete(); y = HOJA.sup; };
  const espacio = (mm) => { if(y + mm > limite) nuevaPagina(); };
  const parrafo = (texto, opc = {}) => {
    doc.setFont('helvetica', opc.negrita ? 'bold' : 'normal'); doc.setFontSize(opc.tam || 10); doc.setTextColor(...(opc.color || TINTA));
    const lineas = doc.splitTextToSize(texto, anchoTexto);
    const alto = (opc.tam || 10) * 0.42;
    lineas.forEach((l, i) => {
      espacio(alto);
      const ultima = i === lineas.length - 1;
      doc.text(l, HOJA.izq, y, opc.justificar && !ultima ? { maxWidth: anchoTexto, align: 'justify' } : {});
      y += alto;
    });
    y += opc.despues ?? 2.5;
  };
  const subtitulo = (texto) => {
    espacio(16);
    y += 2;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11.5); doc.setTextColor(...GUINDA);
    doc.text(texto, HOJA.izq, y);
    doc.setDrawColor(...DORADO); doc.setLineWidth(0.4); doc.line(HOJA.izq, y + 1.8, HOJA.izq + 22, y + 1.8);
    y += 7;
  };
  const tabla = (cabeza, filas, opc = {}) => {
    doc.autoTable({
      startY: y, head: [cabeza], body: filas, foot: opc.pie ? [opc.pie] : undefined,
      margin: { left: HOJA.izq, right: HOJA.der, top: HOJA.sup, bottom: HOJA.inf },
      theme: 'grid', rowPageBreak: 'avoid',
      styles: { font: 'helvetica', fontSize: opc.chica ? 7.6 : 8.6, cellPadding: 1.8, textColor: TINTA, lineColor: [228, 214, 200], lineWidth: 0.2, valign: 'middle' },
      headStyles: { fillColor: GUINDA, textColor: 255, fontStyle: 'bold', halign: 'center', overflow: 'linebreak', minCellWidth: 12 },
      footStyles: { fillColor: [246, 238, 221], textColor: GUINDA, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [251, 247, 242] },
      columnStyles: opc.columnas || {},
      didDrawPage: () => membrete(),
      didDrawCell: opc.alDibujar,
      showFoot: 'lastPage',
    });
    y = doc.lastAutoTable.finalY + 6;
  };
  const der = { halign: 'right' }, centro = { halign: 'center' };

  // ---- portada del texto: fecha, título y subtítulo ----
  membrete();
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...TINTA);
  doc.text(`Pachuca de Soto, Hgo., a ${fechaLarga(op.fecha)}`, HOJA.w - HOJA.der, y, { align: 'right' });
  y += 11;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(...GUINDA);
  doc.splitTextToSize(op.titulo, anchoTexto).forEach(l => { doc.text(l, HOJA.izq, y); y += 6.4; });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...GRIS);
  const alcance = programas.length === state.programs.length ? `Todos los programas (${programas.length})` : programas.length === 1 ? `${programas[0].clave} · ${programas[0].nombre}` : `${programas.length} programas seleccionados`;
  doc.text(doc.splitTextToSize(`Secretaría de Bienestar e Inclusión Social · ${alcance} · Cifras al ${fechaLarga(op.fecha)}`, anchoTexto), HOJA.izq, y);
  y += 4.5;
  doc.setDrawColor(...DORADO); doc.setLineWidth(0.6); doc.line(HOJA.izq, y, HOJA.w - HOJA.der, y);
  y += 8;

  // ---- totales ----
  const datos = programas.map(p => ({
    p, aut: totalAutorizadoNeto(p), comp: totalComprometido(p), compEf: totalComprometidoEfectivo(p),
    sol: totalSolicitadoHacienda(p), autH: totalAutorizadoPorHacienda(p), disp: totalPagado(p),
  }));
  const T = datos.reduce((t, x) => { ['aut', 'comp', 'compEf', 'sol', 'autH', 'disp'].forEach(k => t[k] += x[k]); return t; }, { aut: 0, comp: 0, compEf: 0, sol: 0, autH: 0, disp: 0 });
  const disponible = Math.max(T.aut - T.compEf, 0);
  let n = 0;

  if(op.resumen){
    subtitulo(`${++n}. Resumen ejecutivo`);
    const quien = programas.length === 1 ? `el ${programas[0].nombre} (${programas[0].clave})` : `${programas.length} programas sociales`;
    parrafo(`Al ${fechaLarga(op.fecha)}, ${programas.length === 1 ? 'el reporte comprende' : 'se reportan'} ${quien}, con un monto autorizado vigente de ${fmtMoney(T.aut)}. De este monto se ha comprometido mediante dictaminación ${fmtMoney(T.comp)} (${pctTxt(T.comp, T.aut)}); se han solicitado a la Secretaría de Hacienda ${fmtMoney(T.sol)} (${pctTxt(T.sol, T.aut)}), de los cuales Hacienda ha autorizado ${fmtMoney(T.autH)} (${pctTxt(T.autH, T.aut)}), y se han dispersado ${fmtMoney(T.disp)} (${pctTxt(T.disp, T.aut)}). El recurso disponible sin comprometer asciende a ${fmtMoney(disponible)} (${pctTxt(disponible, T.aut)}).`, { justificar: true });
    if(datos.length > 1){
      const mayor = datos[0];
      const conDisp = datos.filter(x => x.disp > 0).sort((a, b) => b.disp / b.aut - a.disp / a.aut);
      const sinMov = datos.filter(x => x.compEf === 0);
      let t = `El programa con mayor monto autorizado es el ${mayor.p.nombre} (${mayor.p.clave}), que concentra el ${pctTxt(mayor.aut, T.aut)} del total.`;
      if(conDisp.length) t += ` ${conDisp.length === 1 ? 'Registra dispersión de recursos' : 'Registran dispersión de recursos'} ${conDisp.map(x => `${x.p.clave} (${pctTxt(x.disp, x.aut)} de su autorizado)`).join(', ')}.`;
      if(sinMov.length) t += ` ${sinMov.length === 1 ? 'Aún no registra' : 'Aún no registran'} compromiso ni trámites ante Hacienda: ${sinMov.map(x => x.p.clave).join(', ')}.`;
      parrafo(t, { justificar: true });
    }
    tabla(['Concepto', 'Monto', '% del autorizado'], [
      ['Monto autorizado vigente', fmtMoney(T.aut), '100.0%'],
      ['Comprometido (dictaminado)', fmtMoney(T.comp), pctTxt(T.comp, T.aut)],
      ['Solicitado a Hacienda', fmtMoney(T.sol), pctTxt(T.sol, T.aut)],
      ['Autorizado por Hacienda', fmtMoney(T.autH), pctTxt(T.autH, T.aut)],
      ['Dispersado', fmtMoney(T.disp), pctTxt(T.disp, T.aut)],
      ['Disponible sin comprometer', fmtMoney(disponible), pctTxt(disponible, T.aut)],
    ], { columnas: { 1: der, 2: der } });
  }

  if(op.tabla){
    subtitulo(`${++n}. Avance presupuestal por programa`);
    parrafo('La siguiente tabla muestra, para cada programa, el recurso autorizado y su avance en cada etapa del trámite: compromiso, solicitud y autorización de Hacienda, y dispersión. El porcentaje se calcula contra el autorizado de cada programa.', { justificar: true });
    parrafo('Montos en pesos, sin centavos.', { tam: 8, color: GRIS, despues: 1.5 });
    tabla(['Clave', 'Programa', 'Autorizado', 'Comprom.', 'Solicitado', 'Aut. Hacienda', 'Dispersado', '% disp.'],
      datos.map(x => [x.p.clave, x.p.nombre, fmtPesos(x.aut), fmtPesos(x.comp), fmtPesos(x.sol), fmtPesos(x.autH), fmtPesos(x.disp), pctTxt(x.disp, x.aut)]),
      { chica: true, pie: ['', 'Total', fmtPesos(T.aut), fmtPesos(T.comp), fmtPesos(T.sol), fmtPesos(T.autH), fmtPesos(T.disp), pctTxt(T.disp, T.aut)],
        columnas: { 0: { cellWidth: 18, fontStyle: 'bold', textColor: GUINDA }, 2: { ...der, cellWidth: 21 }, 3: { ...der, cellWidth: 21 }, 4: { ...der, cellWidth: 20 }, 5: { ...der, cellWidth: 20 }, 6: { ...der, cellWidth: 20 }, 7: { ...der, cellWidth: 12 } } });
  }

  if(op.distrib && datos.length > 1){
    subtitulo(`${++n}. Distribución del monto autorizado`);
    parrafo(`Participación de cada programa en el monto autorizado total de ${fmtMoney(T.aut)}.`);
    tabla(['Clave', 'Programa', 'Autorizado', '% del total', ''],
      datos.map(x => [x.p.clave, x.p.nombre, fmtMoney(x.aut), pctTxt(x.aut, T.aut), '']),
      { pie: ['', 'Total', fmtMoney(T.aut), '100.0%', ''],
        columnas: { 0: { cellWidth: 20, fontStyle: 'bold', textColor: GUINDA }, 2: { ...der, cellWidth: 30 }, 3: { ...der, cellWidth: 18 }, 4: { cellWidth: 32 } },
        // barrita proporcional en la última columna
        alDibujar: (d) => {
          if(d.section !== 'body' || d.column.index !== 4) return;
          const x = datos[d.row.index]; const w = (d.cell.width - 4) * (x.aut / T.aut);
          doc.setFillColor(...GUINDA); doc.rect(d.cell.x + 2, d.cell.y + d.cell.height / 2 - 1.4, Math.max(w, 0.6), 2.8, 'F');
        } });
  }

  if(op.detalle || op.tramites){
    subtitulo(`${++n}. ${op.detalle ? 'Detalle por programa' : 'Trámites ante Hacienda'}`);
    datos.forEach((x, i) => {
      const p = x.p;
      espacio(40);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(...TINTA);
      doc.splitTextToSize(`${n}.${i + 1} ${p.clave} · ${p.nombre}`, anchoTexto).forEach(l => { doc.text(l, HOJA.izq, y); y += 4.8; });
      y += 1.5;
      if(op.detalle){
        const personas = totalPersonasDictaminadas(p);
        const mods = totalModificado(p);
        parrafo(`El programa cuenta con un monto autorizado de ${fmtMoney(montoAutorizadoBase(p))}${p.monto_autorizado_referencia ? `, mediante oficio ${p.monto_autorizado_referencia}` : ''}${mods ? `, con modificaciones netas por ${fmtMoney(mods)} que lo dejan en ${fmtMoney(x.aut)}` : ''}. Se han dictaminado ${fmtNum(personas)} personas, equivalentes a ${fmtMoney(x.comp)} comprometidos; se han solicitado a Hacienda ${fmtMoney(x.sol)} y se han dispersado ${fmtMoney(x.disp)} (${pctTxt(x.disp, x.aut)} del autorizado).`, { justificar: true });
        tabla(['Concepto', 'Valor'], [
          ['Unidad presupuestal', `UP ${p.unidad_codigo || ''}${p.unidad_nombre ? ' · ' + p.unidad_nombre : ''}`],
          ['Oficio de autorización', `${p.monto_autorizado_referencia || '—'}${p.monto_autorizado_fecha ? ' (' + fechaCorta(p.monto_autorizado_fecha) + ')' : ''}`],
          ['Monto autorizado inicial', fmtMoney(montoAutorizadoBase(p))],
          ['Modificaciones (neto)', fmtMoney(mods)],
          ['Monto autorizado vigente', fmtMoney(x.aut)],
          ['Monto por beneficiario', fmtMoney(p.monto_beneficiario)],
          ['Meta de beneficiarios', fmtNum(p.meta_beneficiarios)],
          ['Personas dictaminadas', `${fmtNum(personas)} (${pctTxt(personas, Number(p.meta_beneficiarios) || 0)} de la meta)`],
          ['Dictámenes', String((p.dictamenes || []).length)],
        ], { columnas: { 0: { cellWidth: 60, fontStyle: 'bold' } } });
        tabla(['Etapa', 'Monto', '% del autorizado'], [
          ['Autorizado vigente', fmtMoney(x.aut), '100.0%'],
          ['Comprometido (dictaminado)', fmtMoney(x.comp), pctTxt(x.comp, x.aut)],
          ['Solicitado a Hacienda', fmtMoney(x.sol), pctTxt(x.sol, x.aut)],
          ['Autorizado por Hacienda', fmtMoney(x.autH), pctTxt(x.autH, x.aut)],
          ['Dispersado', fmtMoney(x.disp), pctTxt(x.disp, x.aut)],
          ['Disponible sin comprometer', fmtMoney(Math.max(x.aut - x.compEf, 0)), pctTxt(Math.max(x.aut - x.compEf, 0), x.aut)],
        ], { columnas: { 1: der, 2: der } });
        if((p.modificaciones || []).length){
          tabla(['Modificación', 'Fecha', 'Motivo', 'Monto'], p.modificaciones.map(m => [m.tipo, fechaCorta(m.created_at), m.motivo || '—', (m.tipo === 'Ampliación' ? '+ ' : '− ') + fmtMoney(m.monto)]), { columnas: { 3: der } });
        }
      }
      if(op.tramites){
        const tram = p.solicitudesHacienda || [];
        if(!tram.length){ parrafo('Sin trámites registrados ante la Secretaría de Hacienda.', { color: GRIS }); }
        else {
          const pagoDe = (h) => (p.pagos || []).find(g => g.hacienda_id === h.id);
          tabla(['Folio', 'Fecha', 'Beneficiario / periodo', 'Solicitado', 'Aut. Hacienda', 'Dispersado'],
            tram.map(h => { const g = pagoDe(h); return [h.folio, fechaCorta(h.fecha), [h.proveedor, h.periodo].filter(Boolean).join(' · ') || '—', fmtMoney(h.monto), h.autorizacion ? fmtMoney(h.autorizacion.monto_autorizado) : 'Pendiente', g ? fmtMoney(g.monto) : '—']; }),
            { chica: true, pie: ['', '', `${tram.length} trámite(s)`, fmtMoney(x.sol), fmtMoney(x.autH), fmtMoney(x.disp)],
              columnas: { 0: { cellWidth: 18 }, 1: { cellWidth: 19, ...centro }, 3: { ...der, cellWidth: 24 }, 4: { ...der, cellWidth: 24 }, 5: { ...der, cellWidth: 24 } } });
        }
      }
      y += 2;
    });
  }

  // ---- cierre y numeración ----
  espacio(14);
  doc.setFont('helvetica', 'italic'); doc.setFontSize(8.5); doc.setTextColor(...GRIS);
  doc.text(doc.splitTextToSize(`Reporte generado por el Sistema de Programas Sociales de la Secretaría de Bienestar e Inclusión Social el ${fechaLarga(hoyISO())}. Las cifras corresponden a la información registrada en el sistema a esa fecha.`, anchoTexto), HOJA.izq, y + 4);
  const total = doc.getNumberOfPages();
  for(let i = 1; i <= total; i++){
    doc.setPage(i);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...GRIS);
    doc.text(`Página ${i} de ${total}`, HOJA.izq, HOJA.h - 22 + 4 * 3.4);
  }
  return doc;
}
