-- Datos legibles de cada Solicitud a Hacienda: a quién se le paga y qué periodo cubre
ALTER TABLE solicitudes_hacienda ADD COLUMN IF NOT EXISTS proveedor TEXT;
ALTER TABLE solicitudes_hacienda ADD COLUMN IF NOT EXISTS periodo TEXT;
