/**
 * Sube archivos (oficios de Monto Autorizado / Modificaciones) a una carpeta
 * fija de Google Drive usando un "Web App" de Google Apps Script como
 * intermediario, y devuelve un link público de solo-lectura para mostrar el
 * botón "Ver Documento".
 *
 * Este método NO requiere crear una cuenta de servicio en Google Cloud: el
 * Apps Script se ejecuta con el permiso de la cuenta de Google del usuario
 * que lo desplegó, así que solo necesitas pegar el código de
 * `google-apps-script/Code.gs` en https://script.google.com, desplegarlo
 * como Web App, y poner esa URL aquí.
 *
 * Ya viene configurado con el Web App real que se desplegó para este
 * proyecto, así que funciona sin tocar nada más. Si en algún momento se
 * vuelve a desplegar el script y cambia la URL, solo hay que actualizar la
 * variable de entorno GOOGLE_APPS_SCRIPT_URL en Render (ver
 * backend/.env.example) — no hace falta tocar este archivo.
 *
 *   GOOGLE_APPS_SCRIPT_URL  → la URL que termina en "/exec" que da Google
 *                             Apps Script al desplegar el Web App.
 *   GOOGLE_DRIVE_FOLDER_ID  → el ID de la carpeta de Drive donde se guardarán
 *                             los documentos (ya viene con un valor por
 *                             defecto, la carpeta indicada).
 */

const DEFAULT_APPS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbzrW2tVQj9X9R-9ll7kLJIJYHyv-krLJhfbwX92WgSclRkiQADfD5kuVAHa_XMXqGE5/exec';

const FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID || '1YKQSocJcd_05eN87_vqD4yA6k3OzVfyV';

/**
 * Sube un archivo (buffer en memoria) a la carpeta configurada de Drive,
 * a través del Web App de Apps Script.
 * @returns {Promise<{url:string, nombre:string, id:string}>}
 */
async function uploadDocumento(buffer, originalName, mimeType) {
  const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL || DEFAULT_APPS_SCRIPT_URL;

  let res;
  try {
    res = await fetch(scriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      redirect: 'follow',
      body: JSON.stringify({
        nombre: originalName,
        mimeType: mimeType || 'application/octet-stream',
        folderId: FOLDER_ID,
        base64: buffer.toString('base64'),
      }),
    });
  } catch (networkErr) {
    throw new Error('No se pudo conectar con el Web App de Google Apps Script.');
  }

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(
      'El Web App de Google Apps Script no respondió con el formato esperado. ' +
      'Verifica que el despliegue esté configurado con acceso "Cualquier usuario" ' +
      'y que el código sea el de google-apps-script/Code.gs.'
    );
  }

  if (!data.ok) {
    throw new Error(data.error || 'Error al subir el documento a Google Drive.');
  }

  return { url: data.url, nombre: data.nombre || originalName, id: data.id };
}

module.exports = { uploadDocumento };