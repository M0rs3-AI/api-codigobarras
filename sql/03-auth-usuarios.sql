/*
  Login de usuario contra SEG_USUARIOS (OPCIONAL).

  Habilita AUTH_ENABLED: la app pide usuario y contrasena ademas de la clave de
  activacion, y cada escaneo revalida que la cuenta siga de alta.

  A DIFERENCIA DE 01 Y 02, AQUI NO SE CREA NADA NUEVO.
  ---------------------------------------------------
  El ERP del cliente ya trae lo necesario:

      CREATE PROCEDURE [dbo].[SEG_Usuarios_Select_Password] @Codigo varchar(15) AS
      SELECT Password FROM SEG_USUARIOS WITH(NoLock)
      WHERE Codigo = @Codigo and Anulado = 0

  Ese SP resuelve las dos preguntas del bridge de una vez:

    - devuelve fila  -> el usuario existe Y esta de alta (Anulado = 0)
    - no devuelve    -> no existe, o esta dado de baja

  Por eso el unico paso obligatorio de este archivo es el GRANT del punto 1.
  Los puntos 2 y 3 son mejoras opcionales.

  DAR DE BAJA A UN USUARIO
  ------------------------
      UPDATE dbo.SEG_USUARIOS SET Anulado = 1 WHERE Codigo = '<usuario>';

  Surte efecto en el siguiente escaneo del dispositivo (como mucho tras
  AUTH_STATUS_CACHE_SECONDS segundos, 15 por defecto). La app borra entonces la
  sesion, el usuario, la contrasena y la clave de activacion del telefono.
*/

USE [<NOMBRE_BASE_DATOS>];
GO

/* ---------------------------------------------------------------------------
   1. OBLIGATORIO. Unico permiso que necesita el login.

      El usuario del bridge sigue con DENY SELECT sobre todo el esquema (ver
      01-usuario-minimo-privilegio.sql): NO puede leer SEG_USUARIOS ni ninguna
      otra tabla, solo ejecutar este procedimiento. Eso es lo que hace que
      comprometer el bridge no sirva para leer -ni cifrar y pedir rescate por-
      la base del cliente.
   --------------------------------------------------------------------------- */

GRANT EXECUTE ON OBJECT::[dbo].[SEG_Usuarios_Select_Password] TO [bridge_codigobarras];
GO

/* ---------------------------------------------------------------------------
   2. OPCIONAL (recomendado): SP de estado.

      El bridge comprueba en CADA escaneo si la cuenta sigue de alta. Sin este
      procedimiento reutiliza el de login, que funciona pero arrastra la
      contrasena cifrada por la red cientos de veces al dia sin necesidad.

      Este devuelve un 1 y nada mas. Configurar despues:
          AUTH_SP_STATUS_NAME=dbo.SEG_Usuarios_Activo
   --------------------------------------------------------------------------- */

CREATE OR ALTER PROCEDURE [dbo].[SEG_Usuarios_Activo]
    @Código varchar(15)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT TOP (1) Activo = CONVERT(bit, 1)
    FROM   dbo.SEG_USUARIOS WITH (NOLOCK)
    WHERE  Código = @Código
      AND  Anulado = 0;
END
GO

GRANT EXECUTE ON OBJECT::[dbo].[SEG_Usuarios_Activo] TO [bridge_codigobarras];
GO

/* ---------------------------------------------------------------------------
   3. OPCIONAL: envoltorio que devuelve la contrasena como varbinary.

      POR QUE PUEDE HACER FALTA
      -------------------------
      La contrasena cifrada cae siempre en bytes altos: una clave de 5-10
      caracteres produce bytes ~155-200 (p.ej. 'admin' -> 175 169 172 162 158).
      Como la columna es varchar, el driver la entrega ya convertida a texto
      segun la pagina de codigos de la intercalacion, y el tramo 0x80-0x9F es
      justamente donde CP1252 e ISO-8859-1 no coinciden.

      El bridge lo resuelve por su cuenta asumiendo CP1252 (lo normal en
      intercalaciones latinas) y permite cambiarlo con AUTH_PASSWORD_ENCODING.
      Pero si la instalacion usa otra pagina de codigos, o si prefieres no
      depender de ese detalle, este envoltorio entrega los bytes crudos y el
      problema desaparece: el bridge detecta el varbinary y se salta la
      conversion de texto.

      Configurar despues:
          AUTH_SP_LOGIN_NAME=dbo.SEG_Usuarios_Select_Password_Bin

      SINTOMA DE QUE HACE FALTA: el login falla siempre con credenciales
      correctas y en el log del bridge aparece "credencial ilegible".
   --------------------------------------------------------------------------- */

CREATE OR ALTER PROCEDURE [dbo].[SEG_Usuarios_Select_Password_Bin]
    @Código varchar(15)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT TOP (1) Password = CONVERT(varbinary(max), Password)
    FROM   dbo.SEG_USUARIOS WITH (NOLOCK)
    WHERE  Código = @Código
      AND  Anulado = 0;
END
GO

GRANT EXECUTE ON OBJECT::[dbo].[SEG_Usuarios_Select_Password_Bin] TO [bridge_codigobarras];
GO

/*
  VERIFICACION
  ------------
  Conectado COMO bridge_codigobarras:

      EXEC dbo.SEG_Usuarios_Select_Password '<usuario>';   -- debe funcionar
      SELECT TOP 1 * FROM dbo.SEG_USUARIOS;                -- debe FALLAR

  Si el SELECT funciona, el usuario tiene mas permisos de los que deberia:
  revisa a que roles pertenece (hay una consulta al final de 01).

  SOBRE LA FUERZA DEL CIFRADO DE Password
  ---------------------------------------
  La columna no guarda un hash: guarda el "empaquetador de claves" de FoxPro, un
  desplazamiento reversible cuyo unico secreto es el algoritmo. Quien consiga
  leer esa columna recupera las contrasenas en claro sin esfuerzo.

  No se puede cambiar sin tocar el ERP -el FoxPro escribe esa misma columna-,
  asi que la defensa real esta en los permisos: el GRANT del punto 1 es lo unico
  que este usuario puede hacer, y sin SELECT sobre SEG_USUARIOS la columna nunca
  queda expuesta. Por eso NO conviene "simplificar" dando db_datareader al
  usuario del bridge.
*/
