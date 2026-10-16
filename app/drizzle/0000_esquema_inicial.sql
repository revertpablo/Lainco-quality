CREATE TABLE "decision" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"reglaId" uuid NOT NULL,
	"estadoAnterior" text NOT NULL,
	"estadoNuevo" text NOT NULL,
	"autorId" uuid NOT NULL,
	"fecha" timestamp with time zone DEFAULT now() NOT NULL,
	"justificacion" text,
	"severidad" text,
	"parametros" jsonb,
	"basadaEnSugerencia" boolean DEFAULT false NOT NULL,
	"loteId" uuid,
	CONSTRAINT "decisionPk" PRIMARY KEY("id"),
	CONSTRAINT "decisionCambiaDeEstado" CHECK ("decision"."estadoAnterior" <> "decision"."estadoNuevo")
);
--> statement-breakpoint
CREATE TABLE "estado" (
	"codigo" text NOT NULL,
	"descripcion" text NOT NULL,
	"orden" integer NOT NULL,
	CONSTRAINT "estadoPk" PRIMARY KEY("codigo")
);
--> statement-breakpoint
CREATE TABLE "estadoRegla" (
	"reglaId" uuid NOT NULL,
	"estado" text DEFAULT 'pendienteDeAnalizar' NOT NULL,
	"severidadAsignada" text,
	"parametros" jsonb,
	"actualizadoEn" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "estadoReglaPk" PRIMARY KEY("reglaId")
);
--> statement-breakpoint
CREATE TABLE "estadoSincronizacion" (
	"codigo" text NOT NULL,
	"descripcion" text NOT NULL,
	"orden" integer NOT NULL,
	CONSTRAINT "estadoSincronizacionPk" PRIMARY KEY("codigo")
);
--> statement-breakpoint
CREATE TABLE "lenguaje" (
	"codigo" text NOT NULL,
	"descripcion" text NOT NULL,
	"orden" integer NOT NULL,
	CONSTRAINT "lenguajePk" PRIMARY KEY("codigo")
);
--> statement-breakpoint
CREATE TABLE "origen" (
	"codigo" text NOT NULL,
	"descripcion" text NOT NULL,
	"orden" integer NOT NULL,
	CONSTRAINT "origenPk" PRIMARY KEY("codigo")
);
--> statement-breakpoint
CREATE TABLE "regla" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"origen" text NOT NULL,
	"clave" text NOT NULL,
	"lenguaje" text NOT NULL,
	"nombre" text NOT NULL,
	"descripcion" text DEFAULT '' NOT NULL,
	"tipo" text,
	"severidadDefault" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"atributoCleanCode" text,
	"impactos" jsonb,
	"parametros" jsonb,
	"hashDescripcion" text NOT NULL,
	"deprecadaEn" timestamp with time zone,
	"probableLocalmente" boolean,
	"primeraSincronizacion" timestamp with time zone DEFAULT now() NOT NULL,
	"ultimaModificacion" timestamp with time zone DEFAULT now() NOT NULL,
	"altaEnSincronizacionId" uuid,
	"modificadaEnSincronizacionId" uuid,
	CONSTRAINT "reglaPk" PRIMARY KEY("id"),
	CONSTRAINT "reglaOrigenClave" UNIQUE("origen","clave")
);
--> statement-breakpoint
CREATE TABLE "rol" (
	"codigo" text NOT NULL,
	"descripcion" text NOT NULL,
	"orden" integer NOT NULL,
	CONSTRAINT "rolPk" PRIMARY KEY("codigo")
);
--> statement-breakpoint
CREATE TABLE "sincronizacion" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"origen" text NOT NULL,
	"iniciadaEn" timestamp with time zone DEFAULT now() NOT NULL,
	"terminadaEn" timestamp with time zone,
	"estado" text DEFAULT 'enCurso' NOT NULL,
	"nuevas" integer DEFAULT 0 NOT NULL,
	"modificadas" integer DEFAULT 0 NOT NULL,
	"deprecadas" integer DEFAULT 0 NOT NULL,
	"error" text,
	"disparadaPorId" uuid,
	CONSTRAINT "sincronizacionPk" PRIMARY KEY("id")
);
--> statement-breakpoint
CREATE TABLE "usuario" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"nombre" text NOT NULL,
	"email" text,
	"githubLogin" text,
	"rol" text DEFAULT 'analista' NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"creadoEn" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usuarioPk" PRIMARY KEY("id"),
	CONSTRAINT "usuarioEmail" UNIQUE("email"),
	CONSTRAINT "usuarioGithubLogin" UNIQUE("githubLogin"),
	CONSTRAINT "usuarioConIdentidad" CHECK ("usuario"."email" is not null or "usuario"."githubLogin" is not null),
	CONSTRAINT "usuarioEmailEnMinusculas" CHECK ("usuario"."email" = lower("usuario"."email")),
	CONSTRAINT "usuarioGithubLoginEnMinusculas" CHECK ("usuario"."githubLogin" = lower("usuario"."githubLogin"))
);
--> statement-breakpoint
CREATE TABLE "vistaGuardada" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"nombre" text NOT NULL,
	"usuarioId" uuid NOT NULL,
	"filtros" jsonb NOT NULL,
	"compartida" boolean DEFAULT false NOT NULL,
	"creadaEn" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vistaGuardadaPk" PRIMARY KEY("id"),
	CONSTRAINT "vistaGuardadaUsuarioNombre" UNIQUE("usuarioId","nombre")
);
--> statement-breakpoint
ALTER TABLE "decision" ADD CONSTRAINT "decisionRegla" FOREIGN KEY ("reglaId") REFERENCES "public"."regla"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision" ADD CONSTRAINT "decisionEstadoAnterior" FOREIGN KEY ("estadoAnterior") REFERENCES "public"."estado"("codigo") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision" ADD CONSTRAINT "decisionEstadoNuevo" FOREIGN KEY ("estadoNuevo") REFERENCES "public"."estado"("codigo") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision" ADD CONSTRAINT "decisionAutor" FOREIGN KEY ("autorId") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estadoRegla" ADD CONSTRAINT "estadoReglaRegla" FOREIGN KEY ("reglaId") REFERENCES "public"."regla"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estadoRegla" ADD CONSTRAINT "estadoReglaEstado" FOREIGN KEY ("estado") REFERENCES "public"."estado"("codigo") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regla" ADD CONSTRAINT "reglaOrigen" FOREIGN KEY ("origen") REFERENCES "public"."origen"("codigo") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regla" ADD CONSTRAINT "reglaLenguaje" FOREIGN KEY ("lenguaje") REFERENCES "public"."lenguaje"("codigo") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regla" ADD CONSTRAINT "reglaAltaEnSincronizacion" FOREIGN KEY ("altaEnSincronizacionId") REFERENCES "public"."sincronizacion"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regla" ADD CONSTRAINT "reglaModificadaEnSincronizacion" FOREIGN KEY ("modificadaEnSincronizacionId") REFERENCES "public"."sincronizacion"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sincronizacion" ADD CONSTRAINT "sincronizacionOrigen" FOREIGN KEY ("origen") REFERENCES "public"."origen"("codigo") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sincronizacion" ADD CONSTRAINT "sincronizacionEstado" FOREIGN KEY ("estado") REFERENCES "public"."estadoSincronizacion"("codigo") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sincronizacion" ADD CONSTRAINT "sincronizacionDisparadaPor" FOREIGN KEY ("disparadaPorId") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usuario" ADD CONSTRAINT "usuarioRol" FOREIGN KEY ("rol") REFERENCES "public"."rol"("codigo") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vistaGuardada" ADD CONSTRAINT "vistaGuardadaUsuario" FOREIGN KEY ("usuarioId") REFERENCES "public"."usuario"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "decisionReglaFecha" ON "decision" USING btree ("reglaId","fecha");--> statement-breakpoint
CREATE INDEX "decisionLote" ON "decision" USING btree ("loteId");--> statement-breakpoint
CREATE INDEX "estadoReglaPorEstado" ON "estadoRegla" USING btree ("estado");--> statement-breakpoint
CREATE INDEX "reglaLenguajeTipo" ON "regla" USING btree ("lenguaje","tipo");--> statement-breakpoint
CREATE INDEX "reglaTags" ON "regla" USING gin ("tags");