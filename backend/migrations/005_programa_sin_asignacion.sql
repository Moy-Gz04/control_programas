-- Programas que pasan directo del Autorizado por Hacienda a la Dispersión,
-- sin Archivo de Asignación (p. ej. Subsidio al Servicio de Verificación Vehicular).
ALTER TABLE programas ADD COLUMN IF NOT EXISTS requiere_asignacion BOOLEAN NOT NULL DEFAULT true;
UPDATE programas SET requiere_asignacion = false WHERE clave = 'UP05-0003';
