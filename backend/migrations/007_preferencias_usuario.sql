-- Preferencias por usuario (por ahora, la apariencia del asistente: color, estrella, ropa, lentes y encendido)
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS preferencias JSONB NOT NULL DEFAULT '{}'::jsonb;
