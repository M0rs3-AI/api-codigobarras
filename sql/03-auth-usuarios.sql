/*
  Usuarios de la app y estado de licencia (PLANTILLA / PLACEHOLDER).

  QUE ES ESTO
  -----------
  El bridge necesita responder dos preguntas contra la base del cliente:

    1. login:   dado un usuario, traer su credencial cifrada y si esta activo.
    2. escaneo: dado un usuario, decir si SIGUE activo. Se pregunta en CADA
                consulta, para que revocar una cuenta corte el servicio en el
                acto y no cuando caduque la sesion.

  Este archivo es una PLANTILLA: el cliente todavia no ha entregado ni el nombre
  real de la tabla, ni sus columnas, ni el esquema de cifrado de la credencial.
  Ajusta los nombres aqui y refleja el mismo cambio en:

      src/lib/db.ts             -> interface UsuariosTable / Database
      src/repositories/users.ts -> las dos consultas

  POR QUE STORED PROCEDURES Y NO SELECT DIRECTO
  ---------------------------------------------
  El usuario del bridge tiene DENY SELECT sobre todo el esquema (ver
  01-usuario-minimo-privilegio.sql). Ese DENY es justamente lo que hace que
  comprometer el bridge no signifique comprometer la base: sin el, quien tome el
  control del proceso puede leer -o cifrar y pedir rescate por- lo que ese
  usuario alcance.

  Dar GRANT SELECT sobre la tabla de usuarios para el login abriria un agujero en
  esa politica, y ademas seria SELECT sobre la tabla que contiene credenciales.
  Con dos procedimientos y GRANT EXECUTE sobre ellos, el bridge sigue sin poder
  leer una sola tabla por su cuenta.

  Si eliges esta via (recomendada), cambia las consultas de
  src/repositories/users.ts por las llamadas parametrizadas que ese archivo deja
  documentadas.
*/

USE [<NOMBRE_BASE_DATOS>];
GO

/* ---------------------------------------------------------------------------
   1. Tabla de usuarios de la app. PLACEHOLDER: si el cliente ya tiene la suya,
      BORRA este bloque y apunta los procedimientos de abajo a la tabla real.
   --------------------------------------------------------------------------- */

IF OBJECT_ID('dbo.BIZOR_APP_USUARIOS', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.BIZOR_APP_USUARIOS
    (
        id       uniqueidentifier NOT NULL CONSTRAINT DF_BIZOR_APP_USUARIOS_id     DEFAULT NEWID(),
        usuario  varchar(64)      NOT NULL,
        -- Credencial CIFRADA. No es un hash: el cliente indica que se descifra
        -- para compararla. Ver el placeholder decryptStoredSecret en
        -- src/lib/crypto.ts.
        --
        -- Lo ideal es que el descifrado ocurra AQUI DENTRO (DecryptByKey), para
        -- que ni el ciphertext ni la clave salgan nunca de SQL Server. Si se
        -- hace asi, el SP de login no debe devolver la credencial: recibe la
        -- contrasena y devuelve solo un booleano (ver bloque 2-bis).
        password varbinary(max)   NOT NULL,
        activo   bit              NOT NULL CONSTRAINT DF_BIZOR_APP_USUARIOS_activo DEFAULT 1,
        creado   datetime2(0)     NOT NULL CONSTRAINT DF_BIZOR_APP_USUARIOS_creado DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_BIZOR_APP_USUARIOS PRIMARY KEY CLUSTERED (id),
        CONSTRAINT UQ_BIZOR_APP_USUARIOS_usuario UNIQUE (usuario)
    );
END
GO

/* ---------------------------------------------------------------------------
   2. SP de login. Devuelve como mucho UNA fila.
   --------------------------------------------------------------------------- */

CREATE OR ALTER PROCEDURE [dbo].[BIZOR_App_Usuario_Login]
    @usuario varchar(64)
AS
BEGIN
    SET NOCOUNT ON;

    -- El bridge ya acota la entrada, pero el SP no confia en quien lo llama.
    IF @usuario IS NULL OR LEN(LTRIM(RTRIM(@usuario))) = 0 RETURN;

    SET @usuario = LTRIM(RTRIM(@usuario));

    SELECT TOP (1)
           id       = CONVERT(varchar(36), U.id),
           usuario  = U.usuario,
           -- PLACEHOLDER: la credencial tal y como la espere el bridge.
           password = CONVERT(varchar(max), U.password),
           activo   = U.activo
    FROM   dbo.BIZOR_APP_USUARIOS U WITH (NOLOCK)
    WHERE  U.usuario = @usuario;
END
GO

/* ---------------------------------------------------------------------------
   2-bis. ALTERNATIVA RECOMENDADA: verificar dentro de la base.

   Con esta version la credencial cifrada NUNCA sale de SQL Server y el bridge
   no necesita conocer ni el algoritmo ni la clave. Descomenta y adapta cuando
   el cliente entregue el esquema de cifrado.

   CREATE OR ALTER PROCEDURE [dbo].[BIZOR_App_Usuario_Verificar]
       @usuario  varchar(64),
       @password nvarchar(128)
   AS
   BEGIN
       SET NOCOUNT ON;

       OPEN SYMMETRIC KEY <NOMBRE_CLAVE> DECRYPTION BY CERTIFICATE <NOMBRE_CERT>;

       SELECT TOP (1)
              usuario = U.usuario,
              activo  = U.activo,
              valido  = CASE
                          WHEN CONVERT(nvarchar(128), DecryptByKey(U.password)) = @password
                          THEN CONVERT(bit, 1) ELSE CONVERT(bit, 0)
                        END
       FROM   dbo.BIZOR_APP_USUARIOS U
       WHERE  U.usuario = @usuario;

       CLOSE SYMMETRIC KEY <NOMBRE_CLAVE>;
   END
   GO
   --------------------------------------------------------------------------- */

/* ---------------------------------------------------------------------------
   3. SP de estado. Se llama en CADA escaneo, asi que es deliberadamente lo mas
      barato posible: un booleano y nada mas. En particular NO devuelve la
      credencial: no hay razon para pasearla por la red cientos de veces al dia.
   --------------------------------------------------------------------------- */

CREATE OR ALTER PROCEDURE [dbo].[BIZOR_App_Usuario_Estado]
    @usuario varchar(64)
AS
BEGIN
    SET NOCOUNT ON;

    IF @usuario IS NULL OR LEN(LTRIM(RTRIM(@usuario))) = 0 RETURN;

    SELECT TOP (1) activo = U.activo
    FROM   dbo.BIZOR_APP_USUARIOS U WITH (NOLOCK)
    WHERE  U.usuario = LTRIM(RTRIM(@usuario));
END
GO

/* ---------------------------------------------------------------------------
   4. Permisos. Solo EXECUTE sobre estos dos procedimientos: el usuario del
      bridge sigue sin poder leer la tabla directamente.
   --------------------------------------------------------------------------- */

GRANT EXECUTE ON OBJECT::[dbo].[BIZOR_App_Usuario_Login]  TO [bridge_codigobarras];
GO
GRANT EXECUTE ON OBJECT::[dbo].[BIZOR_App_Usuario_Estado] TO [bridge_codigobarras];
GO

/*
  VERIFICACION
  ------------
  Conectado COMO bridge_codigobarras:

      EXEC dbo.BIZOR_App_Usuario_Estado @usuario = 'demo';   -- debe funcionar
      SELECT TOP 1 * FROM dbo.BIZOR_APP_USUARIOS;            -- debe FALLAR

  Si el SELECT funciona, el usuario tiene mas permisos de los que deberia.

  DAR DE BAJA A UN USUARIO
  ------------------------
      UPDATE dbo.BIZOR_APP_USUARIOS SET activo = 0 WHERE usuario = '<usuario>';

  Surte efecto en la siguiente consulta del dispositivo (como mucho tras
  AUTH_STATUS_CACHE_SECONDS segundos, 15 por defecto). La app borra entonces sus
  credenciales guardadas y la clave de activacion.
*/
