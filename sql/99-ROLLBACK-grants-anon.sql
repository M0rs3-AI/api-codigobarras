/*
  ROLLBACK del endurecimiento aplicado el 2026-09-04.

  Restaura los permisos EXECUTE que tenian PUBLIC, anon y authenticated sobre
  las 30 funciones SECURITY DEFINER del esquema public.

  NO EJECUTAR salvo emergencia. Volver a este estado reabre la via por la que
  cualquiera con la clave anon (extraible de cualquier APK) podia leer el
  bridge_token de cada empresa, repuntar su vps_url y crear licencias.

  Si algo dejo de funcionar tras el endurecimiento, la solucion correcta NO es
  este archivo: es que la herramienta afectada use la clave service_role desde
  un backend, nunca la clave anon desde un navegador o una app.
*/
-- (grants originales generados desde pg_proc.proacl)

GRANT EXECUTE ON FUNCTION admin_create_license(uuid,text,integer,integer) TO PUBLIC;
GRANT EXECUTE ON FUNCTION admin_create_license(uuid,text,integer,integer) TO anon;
GRANT EXECUTE ON FUNCTION admin_create_license(uuid,text,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_delete_license(text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION admin_delete_license(text) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_delete_license(text) TO anon;
GRANT EXECUTE ON FUNCTION bump_company_revocation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION bump_company_revocation(uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION bump_company_revocation(uuid) TO anon;
GRANT EXECUTE ON FUNCTION check_and_rotate_session(text,text,text,text,timestamp with time zone,text,text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION check_and_rotate_session(text,text,text,text,timestamp with time zone,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION check_and_rotate_session(text,text,text,text,timestamp with time zone,text,text) TO anon;
GRANT EXECUTE ON FUNCTION create_company(text) TO anon;
GRANT EXECUTE ON FUNCTION create_company(text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION create_company(text) TO authenticated;
GRANT EXECUTE ON FUNCTION create_dobra_license(text,text,text,text,text,text,text,text,text,text,text,text) TO anon;
GRANT EXECUTE ON FUNCTION create_dobra_license(text,text,text,text,text,text,text,text,text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION create_dobra_license(text,text,text,text,text,text,text,text,text,text,text,text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION create_product(text,text,text,integer) TO PUBLIC;
GRANT EXECUTE ON FUNCTION create_product(text,text,text,integer) TO anon;
GRANT EXECUTE ON FUNCTION create_product(text,text,text,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION create_product(text,text,text,integer,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION create_product(text,text,text,integer,boolean) TO PUBLIC;
GRANT EXECUTE ON FUNCTION create_product(text,text,text,integer,boolean) TO anon;
GRANT EXECUTE ON FUNCTION generate_activation_key() TO PUBLIC;
GRANT EXECUTE ON FUNCTION generate_activation_key() TO anon;
GRANT EXECUTE ON FUNCTION generate_activation_key() TO authenticated;
GRANT EXECUTE ON FUNCTION get_license_details(text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_license_details(text) TO anon;
GRANT EXECUTE ON FUNCTION get_license_details(text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION get_tenant_connection(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_tenant_connection(uuid) TO anon;
GRANT EXECUTE ON FUNCTION get_tenant_connection(uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION list_companies() TO PUBLIC;
GRANT EXECUTE ON FUNCTION list_companies() TO authenticated;
GRANT EXECUTE ON FUNCTION list_companies() TO anon;
GRANT EXECUTE ON FUNCTION list_licenses() TO anon;
GRANT EXECUTE ON FUNCTION list_licenses() TO PUBLIC;
GRANT EXECUTE ON FUNCTION list_licenses() TO authenticated;
GRANT EXECUTE ON FUNCTION list_loyalty_accesses(uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION list_loyalty_accesses(uuid) TO anon;
GRANT EXECUTE ON FUNCTION list_loyalty_accesses(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION list_loyalty_tenants() TO authenticated;
GRANT EXECUTE ON FUNCTION list_loyalty_tenants() TO PUBLIC;
GRANT EXECUTE ON FUNCTION list_loyalty_tenants() TO anon;
GRANT EXECUTE ON FUNCTION list_products() TO PUBLIC;
GRANT EXECUTE ON FUNCTION list_products() TO anon;
GRANT EXECUTE ON FUNCTION list_products() TO authenticated;
GRANT EXECUTE ON FUNCTION list_tenant_connections() TO PUBLIC;
GRANT EXECUTE ON FUNCTION list_tenant_connections() TO anon;
GRANT EXECUTE ON FUNCTION list_tenant_connections() TO authenticated;
GRANT EXECUTE ON FUNCTION reactivate_by_machine(text,text,text,timestamp with time zone,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION reactivate_by_machine(text,text,text,timestamp with time zone,text,text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION reactivate_by_machine(text,text,text,timestamp with time zone,text,text) TO anon;
GRANT EXECUTE ON FUNCTION register_loyalty_access(uuid,uuid,text,text,text,text,boolean) TO PUBLIC;
GRANT EXECUTE ON FUNCTION register_loyalty_access(uuid,uuid,text,text,text,text,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION register_loyalty_access(uuid,uuid,text,text,text,text,boolean) TO anon;
GRANT EXECUTE ON FUNCTION register_loyalty_tenant(uuid,text,text,text,text,text,text,uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION register_loyalty_tenant(uuid,text,text,text,text,text,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION register_loyalty_tenant(uuid,text,text,text,text,text,text,uuid) TO anon;
GRANT EXECUTE ON FUNCTION reserve_seat(text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION reserve_seat(text,text,text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION reserve_seat(text,text,text) TO anon;
GRANT EXECUTE ON FUNCTION reveal_loyalty_access_password(uuid) TO anon;
GRANT EXECUTE ON FUNCTION reveal_loyalty_access_password(uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION reveal_loyalty_access_password(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION reveal_tenant_bridge_token(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION reveal_tenant_bridge_token(uuid) TO anon;
GRANT EXECUTE ON FUNCTION reveal_tenant_bridge_token(uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION revoke_activation(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION revoke_activation(uuid,text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION revoke_activation(uuid,text) TO anon;
GRANT EXECUTE ON FUNCTION revoke_license(text) TO authenticated;
GRANT EXECUTE ON FUNCTION revoke_license(text) TO anon;
GRANT EXECUTE ON FUNCTION revoke_license(text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION rls_auto_enable() TO authenticated;
GRANT EXECUTE ON FUNCTION rls_auto_enable() TO anon;
GRANT EXECUTE ON FUNCTION rls_auto_enable() TO PUBLIC;
GRANT EXECUTE ON FUNCTION save_session_token(uuid,text,text,timestamp with time zone,text,text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION save_session_token(uuid,text,text,timestamp with time zone,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION save_session_token(uuid,text,text,timestamp with time zone,text,text) TO anon;
GRANT EXECUTE ON FUNCTION set_loyalty_access_active(uuid,boolean) TO anon;
GRANT EXECUTE ON FUNCTION set_loyalty_access_active(uuid,boolean) TO PUBLIC;
GRANT EXECUTE ON FUNCTION set_loyalty_access_active(uuid,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION set_tenant_connection_active(uuid,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION set_tenant_connection_active(uuid,boolean) TO anon;
GRANT EXECUTE ON FUNCTION set_tenant_connection_active(uuid,boolean) TO PUBLIC;
GRANT EXECUTE ON FUNCTION upsert_tenant_connection(uuid,text,text,boolean) TO anon;
GRANT EXECUTE ON FUNCTION upsert_tenant_connection(uuid,text,text,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION upsert_tenant_connection(uuid,text,text,boolean) TO PUBLIC;
