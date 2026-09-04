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

  PENDIENTE, de menor gravedad
  ----------------------------
  Quedan 22 avisos pg_graphql_*_table_exposed: anon y authenticated tienen
  SELECT sobre 11 tablas, asi que sus nombres y columnas son visibles en el
  esquema GraphQL. Comprobado que el RLS si bloquea la lectura -tenant_connections,
  licenses, companies, activations y products devuelven [] con la clave anon-,
  o sea que es divulgacion de estructura, no de datos. Para cerrarlo del todo:

      REVOKE SELECT ON public.<tabla> FROM anon, authenticated;

  Hacerlo tabla por tabla y comprobando que ninguna app las lea directamente.
*/
