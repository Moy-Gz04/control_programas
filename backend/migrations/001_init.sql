-- =========================================================================
-- Sistema de Programas Sociales — Esquema inicial (Neon / PostgreSQL)
-- =========================================================================

CREATE TABLE IF NOT EXISTS unidades (
  codigo        VARCHAR(2) PRIMARY KEY,
  nombre        TEXT NOT NULL
);

-- Por el momento solo existe un usuario Administrador con acceso total.
-- Se dejan "rol" y "unidad_codigo" listos (con valores por defecto) para el
-- día que se quiera activar acceso por Unidad Presupuestal sin migrar de nuevo.
CREATE TABLE IF NOT EXISTS usuarios (
  id              SERIAL PRIMARY KEY,
  nombre          TEXT NOT NULL,
  email           TEXT UNIQUE NOT NULL,
  password_hash   TEXT NOT NULL,
  rol             VARCHAR(20) NOT NULL DEFAULT 'admin' CHECK (rol IN ('admin','captura')),
  unidad_codigo   VARCHAR(2) REFERENCES unidades(codigo),
  activo          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS programas (
  id                            SERIAL PRIMARY KEY,
  clave                         VARCHAR(20) UNIQUE NOT NULL,
  unidad_codigo                 VARCHAR(2) NOT NULL REFERENCES unidades(codigo),
  nombre                        TEXT NOT NULL,
  monto_beneficiario            NUMERIC(14,2) NOT NULL,
  meta_beneficiarios            INTEGER NOT NULL,
  monto_autorizado              NUMERIC(14,2),
  monto_autorizado_referencia   TEXT,
  monto_autorizado_fecha        TIMESTAMPTZ,
  created_by                    INTEGER REFERENCES usuarios(id),
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS modificaciones (
  id            SERIAL PRIMARY KEY,
  programa_id   INTEGER NOT NULL REFERENCES programas(id) ON DELETE CASCADE,
  tipo          VARCHAR(20) NOT NULL CHECK (tipo IN ('Ampliación','Reducción')),
  monto         NUMERIC(14,2) NOT NULL,
  motivo        TEXT,
  created_by    INTEGER REFERENCES usuarios(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dictamenes (
  id                  SERIAL PRIMARY KEY,
  programa_id         INTEGER NOT NULL REFERENCES programas(id) ON DELETE CASCADE,
  numero              INTEGER NOT NULL,
  monto_autorizado    NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS solicitudes (
  id            SERIAL PRIMARY KEY,
  dictamen_id   INTEGER NOT NULL REFERENCES dictamenes(id) ON DELETE CASCADE,
  numero        INTEGER NOT NULL,
  personas      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS solicitudes_hacienda (
  id            SERIAL PRIMARY KEY,
  programa_id   INTEGER NOT NULL REFERENCES programas(id) ON DELETE CASCADE,
  folio         TEXT,
  monto         NUMERIC(14,2) NOT NULL,
  fecha         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    INTEGER REFERENCES usuarios(id)
);

CREATE TABLE IF NOT EXISTS pagos (
  id            SERIAL PRIMARY KEY,
  programa_id   INTEGER NOT NULL REFERENCES programas(id) ON DELETE CASCADE,
  folio         TEXT,
  monto         NUMERIC(14,2) NOT NULL,
  fecha         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    INTEGER REFERENCES usuarios(id)
);

CREATE INDEX IF NOT EXISTS idx_programas_unidad ON programas(unidad_codigo);
CREATE INDEX IF NOT EXISTS idx_modificaciones_programa ON modificaciones(programa_id);
CREATE INDEX IF NOT EXISTS idx_dictamenes_programa ON dictamenes(programa_id);
CREATE INDEX IF NOT EXISTS idx_solicitudes_dictamen ON solicitudes(dictamen_id);
CREATE INDEX IF NOT EXISTS idx_hacienda_programa ON solicitudes_hacienda(programa_id);
CREATE INDEX IF NOT EXISTS idx_pagos_programa ON pagos(programa_id);

-- Catálogo de Unidades Presupuestales
INSERT INTO unidades (codigo, nombre) VALUES
  ('01','SECRETARÍA DE BIENESTAR E INCLUSIÓN SOCIAL'),
  ('04','DIRECCIÓN GENERAL DE FOMENTO ARTESANAL'),
  ('05','SUBSECRETARÍA DE INCLUSIÓN Y DESARROLLO'),
  ('06','DIRECCIÓN GENERAL DE OPERACIÓN Y LOGÍSTICA DE PROGRAMAS'),
  ('07','DIRECCIÓN GENERAL DE ATENCIÓN AL MIGRANTE'),
  ('08','DIRECCIÓN GENERAL DE ASISTENCIA, ATENCIÓN Y PROTECCIÓN'),
  ('12','DIRECCIÓN GENERAL DE PROSPECTIVA, PLANEACIÓN Y EVALUACIÓN DE LOS PROGRAMAS SOCIALES'),
  ('13','SUBSECRETARÍA DE PARTICIPACIÓN SOCIAL Y FOMENTO ARTESANAL'),
  ('14','DIRECCIÓN GENERAL DE INCLUSIÓN PARA LAS PERSONAS CON DISCAPACIDAD'),
  ('15','SUBSECRETARÍA DE DESARROLLO SOCIAL Y HUMANO'),
  ('16','DIRECCIÓN GENERAL DE SERVIDORES DEL PUEBLO')
ON CONFLICT (codigo) DO NOTHING;
