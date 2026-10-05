# RRPP Suite

Herramientas para RRPP de boliches de Córdoba: **prospección** (cargás una lista de @usuarios de
Instagram, se analizan con Claude, reciben un puntaje de 0 a 10 y tres mensajes de apertura, y
registrás la conversión) y **limpieza de seguidos** (extensión de Chrome para dejar de seguir de
forma segura a quien no te sigue).

El diseño completo está en [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Requisitos

- [Node.js](https://nodejs.org) 22 (mínimo 22.13; hay un `.nvmrc`) y npm 10.
- [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started).
- Un proyecto de [Supabase](https://supabase.com/dashboard). Para desarrollar todo en local
  alcanza con `supabase start`, que necesita Docker.
- Una API key de [Claude](https://platform.claude.com) (`sk-ant-...`).

## Puesta en marcha

1. Cloná el repo e instalá las dependencias de todos los paquetes:

   ```sh
   git clone <url-del-repo> rrpp
   cd rrpp
   npm install
   ```

2. Vinculá tu proyecto de Supabase y aplicá las migraciones. El _project ref_ es el identificador
   de la URL del proyecto (`https://<project-ref>.supabase.co`):

   ```sh
   supabase login
   supabase link --project-ref <project-ref>
   supabase db push
   ```

   Para trabajar con una base local en lugar de la remota: `supabase start` (aplica las
   migraciones) y `supabase status` para ver la URL y las keys.

3. Configurá la API:

   ```sh
   cp apps/api/.env.example apps/api/.env
   ```

   Completá `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY` y `CORS_ORIGINS`.
   Cada variable tiene un comentario que explica de dónde sale. La API valida todo al arrancar y,
   si falta algo, lista qué variables hay que corregir (nunca muestra los valores secretos).

4. Levantá la API en modo desarrollo (se reinicia sola al guardar):

   ```sh
   npm run dev -w @rrpp/api
   ```

5. Verificá que responda:

   ```sh
   curl http://localhost:4000/healthz   # 200 si el proceso está vivo
   curl http://localhost:4000/readyz    # 200 si además llega a la base; 503 si no
   ```

### Producción

```sh
npm ci
npm run build -w @rrpp/api
NODE_ENV=production npm start -w @rrpp/api
```

En producción las variables se definen en el entorno del servicio (Render, Railway, Fly, etc.); el
archivo `.env` es opcional. Usá `/healthz` como _liveness probe_ y `/readyz` como _readiness probe_.
Ante `SIGTERM` la API deja de aceptar conexiones, espera a que terminen los requests en curso y
sale; si tardan más de `SHUTDOWN_TIMEOUT_MS`, corta igual.

## Tipos de la base

`packages/shared/src/database.types.ts` se genera a partir del esquema de Postgres y no se edita a
mano. Regeneralo cada vez que cambies una migración:

```sh
# Desde el proyecto vinculado
supabase gen types typescript --linked --schema public > packages/shared/src/database.types.ts

# O desde la base local (supabase start)
supabase gen types typescript --local --schema public > packages/shared/src/database.types.ts
```

Después corré `npm run typecheck`: los enums de `packages/shared/src/enums.ts` se comparan contra
los generados, así que si cambió un enum en la base, el chequeo de tipos lo marca.

## Scripts

Desde la raíz del repo:

| Script                 | Qué hace                                                       |
| ---------------------- | -------------------------------------------------------------- |
| `npm run lint`         | ESLint con reglas estrictas y chequeo de tipos en todo el repo |
| `npm run format`       | Formatea con Prettier                                          |
| `npm run format:check` | Verifica el formato sin modificar archivos                     |
| `npm run typecheck`    | `tsc --noEmit` en cada paquete                                 |
| `npm test`             | Tests (Vitest) de cada paquete                                 |
| `npm run build`        | Build de los paquetes que lo tienen (hoy, la API)              |

De la API (`-w @rrpp/api`):

| Script                           | Qué hace                                     |
| -------------------------------- | -------------------------------------------- |
| `npm run dev -w @rrpp/api`       | Levanta la API con recarga automática (tsx)  |
| `npm run build -w @rrpp/api`     | Genera `apps/api/dist` con tsup              |
| `npm start -w @rrpp/api`         | Corre el build                               |
| `npm test -w @rrpp/api`          | Tests unitarios y de integración (Supertest) |
| `npm run typecheck -w @rrpp/api` | Chequeo de tipos de la API                   |

La CI (`.github/workflows/ci.yml`) corre lint, formato, tipos, tests y build en cada push y pull
request, y además levanta Postgres con todas las migraciones y corre `supabase db lint`.

## Estructura

```
rrpp/
├── apps/
│   └── api/                 # API REST (Express 5 + TypeScript)
│       ├── src/
│       │   ├── server.ts    # arranque HTTP y apagado ordenado
│       │   ├── app.ts       # middlewares y rutas
│       │   ├── config/      # variables de entorno validadas con zod
│       │   ├── lib/         # logger, errores, clientes de Supabase y Claude
│       │   ├── middleware/  # request id, 404 y manejo de errores
│       │   └── modules/     # health (/healthz, /readyz)
│       └── test/            # unit/ e integration/
├── packages/
│   └── shared/              # enums, normalización de @usuarios y tipos de la base
├── supabase/                # migraciones, seed y config de la CLI
├── docs/ARCHITECTURE.md
└── .github/workflows/ci.yml
```

Los módulos de la API (`/v1`), el worker de análisis, la web, la extensión y el scraper se suman en
los próximos pasos; el plan está en la sección 8 de [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
