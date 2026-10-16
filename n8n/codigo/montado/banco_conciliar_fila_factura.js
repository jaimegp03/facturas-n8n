// Fila exacta para fact_facturas (autoMapInputData); el id va en el filtro por pairedItem.
return $input.all().map((it, i) => ({ json: it.json.fila, pairedItem: { item: i } }));
