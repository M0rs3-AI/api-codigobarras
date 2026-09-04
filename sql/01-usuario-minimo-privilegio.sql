/*
  Usuario de SQL Server para el bridge, con el minimo privilegio posible.

  POR QUE IMPORTA
  ---------------
  Si alguien compromete el bridge, lo unico que consigue es lo que este usuario
  puede hacer. Con un usuario 'sa' o db_owner podria cifrar, borrar o exfiltrar
  la base entera: es exactamente el escenario de ransomware que se quiere
  evitar. Con este usuario solo puede EJECUTAR dos o tres procedimientos que
  devuelven productos. No puede leer tablas directamente, ni escribir, ni
  borrar, ni crear nada.

  Ejecutar UNA vez en la base de datos del cliente, como administrador.
  Sustituye los valores entre <> antes de ejecutar.
*/

USE [<NOMBRE_BASE_DATOS>];
GO

-- 1. Login a nivel de servidor. Usa una contrasena larga y aleatoria; es la que
--    va en SQL_PASSWORD de la configuracion del bridge.
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = 'bridge_codigobarras')
BEGIN
    CREATE LOGIN [bridge_codigobarras]
        WITH PASSWORD = '<CONTRASENA_LARGA_ALEATORIA>',
             CHECK_POLICY = ON,
             DEFAULT_DATABASE = [<NOMBRE_BASE_DATOS>];
END
GO

-- 2. Usuario dentro de la base. Sin pertenencia a NINGUN rol: por defecto no
--    puede hacer absolutamente nada.
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'bridge_codigobarras')
BEGIN
    CREATE USER [bridge_codigobarras] FOR LOGIN [bridge_codigobarras];
END
GO

-- 3. Denegaciones explicitas. DENY gana sobre cualquier GRANT posterior, asi que
--    aunque alguien anada el usuario a un rol por error, sigue sin poder tocar
--    los datos por su cuenta.
DENY SELECT, INSERT, UPDATE, DELETE, ALTER, EXECUTE
    ON SCHEMA::dbo TO [bridge_codigobarras];
GO

-- 4. El unico permiso: ejecutar los procedimientos del bridge. Un GRANT sobre un
--    objeto concreto tiene prioridad sobre el DENY de esquema del paso 3.
GRANT EXECUTE ON OBJECT::[dbo].[INV_Pproductos_Seek_Codigo_Barra] TO [bridge_codigobarras];
GO

-- Solo si el cliente usa stock por bodega (SP_STOCK_NAME).
-- GRANT EXECUTE ON OBJECT::[dbo].[INV_Pproductos_GetStock_Codigo_Barra] TO [bridge_codigobarras];
-- GO

-- Solo si el cliente usa busqueda por texto (SP_SEARCH_NAME). Ver 02-sp-busqueda.sql.
-- GRANT EXECUTE ON OBJECT::[dbo].[INV_Pproductos_Search] TO [bridge_codigobarras];
-- GO

-- Solo si el cliente usa login de usuario (AUTH_ENABLED). Ver 03-auth-usuarios.sql,
-- que ya incluye estos GRANT; se repiten aqui para tener el inventario completo
-- de permisos del bridge en un solo sitio.
-- GRANT EXECUTE ON OBJECT::[dbo].[BIZOR_App_Usuario_Login]  TO [bridge_codigobarras];
-- GRANT EXECUTE ON OBJECT::[dbo].[BIZOR_App_Usuario_Estado] TO [bridge_codigobarras];
-- GO

/*
  VERIFICACION
  ------------
  Conectado COMO bridge_codigobarras, esto debe funcionar:

      EXEC dbo.INV_Pproductos_Seek_Codigo_Barra @CodigoBarra = '7501234567890';

  y todo esto debe fallar con "permission denied":

      SELECT TOP 1 * FROM dbo.INV_PRODUCTOS;
      DELETE FROM dbo.INV_PRODUCTOS;
      DROP TABLE dbo.INV_PRODUCTOS;

  Si alguno de los tres ultimos funciona, el usuario tiene mas permisos de los
  que deberia: revisa a que roles pertenece con

      SELECT r.name FROM sys.database_role_members m
      JOIN sys.database_principals r ON r.principal_id = m.role_principal_id
      JOIN sys.database_principals u ON u.principal_id = m.member_principal_id
      WHERE u.name = 'bridge_codigobarras';
*/
