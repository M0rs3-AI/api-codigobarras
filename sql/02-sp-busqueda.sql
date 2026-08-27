/*
  SP de busqueda por texto (OPCIONAL).

  Alimenta el endpoint POST /search del bridge. Si el cliente no lo instala,
  deja SP_SEARCH_NAME vacio en su configuracion y /search responde 501: la app
  oculta la busqueda por texto y deja solo el escaneo.

  Busca por los tres identificadores que usa el personal de tienda:
    - codigo interno       ej. L355
    - nombre               ej. Impresora Epson
    - codigo de barras     ej. 1231321564

  SEGURIDAD: los dos parametros llegan tipados desde el bridge (tedious
  addParameter), nunca concatenados en texto. No hay SQL dinamico aqui, asi que
  no hay superficie de inyeccion aunque el termino venga del usuario final.

  RENDIMIENTO: el LIKE '%x%' sobre Nombre no puede usar indice. Con catalogos
  grandes revisa el bloque de indices del final.
*/

CREATE OR ALTER PROCEDURE [dbo].[INV_Pproductos_Search]
    @q   varchar(100),
    @top int = 25
AS
BEGIN
    SET NOCOUNT ON;

    -- El bridge ya recorta @top a su maximo, pero el SP no confia en quien lo
    -- llama: un tope aqui protege la base aunque se invoque desde otro sitio.
    IF @top IS NULL OR @top < 1 OR @top > 50 SET @top = 25;
    IF @q IS NULL OR LEN(LTRIM(RTRIM(@q))) < 3 RETURN;

    SET @q = LTRIM(RTRIM(@q));

    SELECT TOP (@top)
           PD.Código,
           PD.Nombre,
           PD.Descripción,
           CodigoBarra = EM.CódigoBarra,
           Marca       = ISNULL(PD.Marca, ''),
           Precio      = ROUND(EM.Precio * CASE WHEN PD.ImpuestoID = '0000000050' THEN 1.15 ELSE 1 END, 2),
           Foto        = PD.URL
    FROM   INV_PRODUCTOS PD WITH (NOLOCK)
           INNER JOIN INV_PRODUCTOS_EMPAQUES EM WITH (NOLOCK)
               ON EM.ProductoID = PD.ID
    WHERE  EM.CódigoBarra = @q
        OR PD.Código      = @q
        OR PD.Nombre LIKE '%' + @q + '%'
    -- Coincidencia exacta de codigo o de codigo de barras primero: si es unica,
    -- la app salta directo a la ficha sin hacer elegir al usuario.
    ORDER BY CASE WHEN EM.CódigoBarra = @q OR PD.Código = @q THEN 0 ELSE 1 END,
             PD.Nombre;
END
GO

GRANT EXECUTE ON OBJECT::[dbo].[INV_Pproductos_Search] TO [bridge_codigobarras];
GO

/*
  INDICES RECOMENDADOS
  --------------------
  Los dos primeros hacen instantanea la busqueda exacta, que es la mas comun.
  El LIKE por nombre sigue siendo un recorrido de tabla; si el catalogo es
  grande y se nota lento, activa full-text search sobre Nombre.

  CREATE NONCLUSTERED INDEX IX_EMPAQUES_CodigoBarra
      ON INV_PRODUCTOS_EMPAQUES (CódigoBarra) INCLUDE (ProductoID, Precio);

  CREATE NONCLUSTERED INDEX IX_PRODUCTOS_Codigo
      ON INV_PRODUCTOS (Código) INCLUDE (Nombre, Marca, URL);
*/
