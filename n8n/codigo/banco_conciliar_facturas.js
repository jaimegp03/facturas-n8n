// Facturas que cambian de estado de pago: la anterior (se revierte) y/o la nueva (pagada).
return $('Banco: procesar').first().json.facturas.map((x) => ({ json: x }));
