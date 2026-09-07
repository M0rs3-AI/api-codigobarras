/*
  Endurecimiento del proyecto Supabase. APLICADO el 2026-09-04.

  Este archivo NO se ejecuta en la base del cliente: va contra el proyecto
  Supabase (el SQL Editor del dashboard). Se guarda aqui para dejar constancia
  y poder reaplicarlo en otros proyectos, como el de Fidelity.

  EL PROBLEMA
  -----------
  30 funciones SECURITY DEFINER del esquema public tenian EXECUTE concedido a
  PUBLIC, anon y authenticated, y ninguna comprobaba autorizacion por dentro.
  SECURITY DEFINER se salta el RLS, asi que el RLS de las tablas no protegia
  nada frente a ellas.

  Con la clave anon -que viaja dentro de cada APK y se extrae en minutos-
  cualquiera podia encadenar:

      list_companies()                    -> company_id de todas las empresas
      reveal_tenant_bridge_token(id)      -> el bridge_token de esa empresa
      list_tenant_connections()           -> su vps_url

  y con eso consultar el SQL Server de cualquier cliente directamente, saltando
  las Edge Functions y su rate limit. Ademas upsert_tenant_connection permitia
  repuntar el vps_url de una empresa a un servidor del atacante, y
  admin_create_license / generate_activation_key fabricar licencias.

  Verificado contra produccion antes de arreglarlo: list_companies,
  list_tenant_connections y reveal_tenant_bridge_token respondian HTTP 200 con
  la clave anon.

  POR QUE HAY QUE REVOCAR A "PUBLIC" Y NO SOLO A "anon"
  ----------------------------------------------------
  Varias funciones tenian el permiso via PUBLIC (aparece como "=X/postgres" en
  pg_proc.proacl). Revocar solo a anon y authenticated no habria servido de
  nada: seguirian heredandolo de PUBLIC.

  service_role conserva EXECUTE porque tiene concesion explicita, y ademas se
  reafirma abajo. Las Edge Functions llaman a la base con service_role, asi que
  no se ven afectadas.
*/

DO $$
DECLARE f record; n int := 0;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace nsp ON nsp.oid = p.pronamespace
    WHERE nsp.nspname = 'public'
      AND p.prosecdef
      -- Las funciones de trigger las invoca el sistema, no un rol.
      AND p.prorettype <> 'trigger'::regtype
      -- Las tres que usan las Edge Functions ya estaban limitadas a
      -- service_role. Se excluyen para no tocar lo que ya estaba bien.
      AND p.proname NOT IN (
        'get_tenant_connection_by_key',
        'insert_barcode_log',
        'check_rate_limit'
      )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.sig);
    n := n + 1;
  END LOOP;

  RAISE NOTICE 'funciones endurecidas: %', n;
END $$;

/*
  VERIFICACION
  ------------
  Debe devolver aun_anon = 0, aun_authenticated = 0 y service_role_ok = total.
*/

SELECT count(*) FILTER (WHERE has_function_privilege('anon',          p.oid, 'EXECUTE')) AS aun_anon,
       count(*) FILTER (WHERE has_function_privilege('authenticated', p.oid, 'EXECUTE')) AS aun_authenticated,
       count(*) FILTER (WHERE has_function_privilege('service_role',  p.oid, 'EXECUTE')) AS service_role_ok,
       count(*)                                                                          AS total
FROM pg_proc p
JOIN pg_namespace nsp ON nsp.oid = p.pronamespace
WHERE nsp.nspname = 'public' AND p.prosecdef AND p.prorettype <> 'trigger'::regtype;

/*
  Y desde fuera, con la clave anon del proyecto, todas estas deben dar HTTP 401:

      curl -X POST https://<ref>.supabase.co/rest/v1/rpc/list_companies \
        -H "apikey: <anon>" -H "Authorization: Bearer <anon>" \
        -H "Content-Type: application/json" -d '{}'

  Mientras que las Edge Functions deben seguir respondiendo
  {"error":"INVALID_OR_EXPIRED_KEY"} ante una activation key inventada. Ese
  mensaje solo aparece si get_tenant_connection_by_key se ejecuto bien: es la
  prueba de que service_role conserva sus permisos.

  ROLLBACK: sql/99-ROLLBACK-grants-anon.sql (leer el aviso de su cabecera).

  SEGUNDA FASE: permisos de tabla. APLICADO el 2026-09-07.
  ------------------------------------------------------
  anon y authenticated tenian ALL (SELECT, INSERT, UPDATE, DELETE, TRUNCATE)
  sobre las 11 tablas de public, incluida licenses. Lo unico que impedia borrar
  la base de licencias con la clave anon del APK era el RLS: una sola politica
  mal escrita y se pierde todo. Ademas el esquema entero era visible por GraphQL
  (22 avisos pg_graphql_*_table_exposed).

  Comprobado antes de aplicarlo: ninguna de las dos apps lee tablas ni llama
  RPC; solo usan Edge Functions, que van con service_role.
*/

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;

/*
  Verificacion: quedan_anon = 0, quedan_auth = 0, service_role_ok > 0.
*/

SELECT count(*) FILTER (WHERE grantee = 'anon')          AS quedan_anon,
       count(*) FILTER (WHERE grantee = 'authenticated') AS quedan_auth,
       count(*) FILTER (WHERE grantee = 'service_role')  AS service_role_ok
FROM information_schema.role_table_grants
WHERE table_schema = 'public';

/*
  Y desde fuera, con la clave anon, estas deben dar HTTP 401:

      curl "https://<ref>.supabase.co/rest/v1/licenses?select=*" -H "apikey: <anon>"
      curl -X DELETE "https://<ref>.supabase.co/rest/v1/licenses?id=neq.<uuid>" -H "apikey: <anon>"

  ROLLBACK de esta fase (los permisos eran uniformemente ALL):

      GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;

  ESTADO DEL LINTER: 84 avisos -> 2. Los 2 que quedan son INFO y correctos:
  barcode_api_logs y rate_limit_buckets tienen RLS activo sin politica, que
  deniega todo; service_role lo pasa por encima, que es lo que se quiere.

  DECISION DEL 2026-09-07: LOS GRANT DE FUNCIONES SE REABRIERON
  --------------------------------------------------------------
  El backoffice movil-app-code-bizor llama a 21 de estas funciones con la clave
  anon y sin login de Supabase (auth.users esta vacio). Al cerrarlas se quedo
  sin acceso.

  El propietario decidio reabrir los EXECUTE, asumiendo el riesgo: la clave anon
  vive solo en su APK de administracion, que no distribuye. Es una decision
  suya, tomada con los datos delante.

  Se reabrieron SOLO las funciones (las 30 sentencias GRANT de arriba, aplicadas
  con "TO PUBLIC, anon, authenticated"). Los permisos de TABLA siguen revocados:
  el backoffice no lee ninguna tabla directamente -verificado, cero .from()- asi
  que devolverselos no le aportaba nada y reabria el DELETE y el TRUNCATE sobre
  licenses.

  Lo que sigue siendo cierto, para cuando se quiera cerrar del todo:
  quien tenga esa clave anon puede llamar a reveal_tenant_bridge_token y
  list_tenant_connections, y con eso entrar al SQL Server de cualquier cliente.
  La clave estuvo commiteada en el historial de movil-app-code-bizor (repo
  privado) y la clave legacy sigue activa.

  El arreglo correcto, cuando haya tiempo: conceder a authenticated en vez de a
  anon, crear un usuario admin en Supabase Auth y poner login en el panel. El
  APK por si solo deja de servir. Es una sentencia SQL y una pantalla.
*/
