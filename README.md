# Facturas: tus gastos en claro

Subes tus facturas (PDF, foto o captura) a una web. Un sistema montado en **n8n** las lee con IA (Gemini), las clasifica por tipo de gasto, detecta duplicadas y suscripciones, lleva la cuenta de todo y te dice con cifras concretas dónde puedes ahorrar. Desde la misma web descargas un Excel con el resumen.

**Punto de entrada: [docs/GUIA.md](docs/GUIA.md)**, la guía de usuario completa (qué es, recorrido por la web pantalla a pantalla, cómo funciona, avisos, privacidad, preguntas frecuentes y glosario).

No hace falta saber n8n para usarlo. Este README explica cómo ponerlo en marcha desde cero.

---

## Qué hay en esta carpeta

| Carpeta / archivo | Para qué sirve |
|---|---|
| `web/index.html` | La web. Se abre con doble clic, sin instalar nada. |
| `n8n/workflows/*.json` | Los 6 "workflows" (automatizaciones) de n8n, por si hay que volver a importarlos. |
| `n8n/docker/` | Cómo se construye el n8n con lo necesario para el Excel. |
| `tests/` | Facturas de ejemplo y scripts que comprueban que todo cuadra. |
| `.env.example` | Plantilla de la configuración (sin contraseñas). |
| `CLAUDE.md` | Documentación técnica detallada. |

Las facturas originales **no** se guardan aquí, sino en `C:\Users\GOMEZ\facturas-almacen`. Esa carpeta está fuera de OneDrive para que no se suban a la nube.

---

## Puesta en marcha (primera vez)

### 1. Instala Docker Desktop
Descárgalo de <https://www.docker.com/products/docker-desktop/>, instálalo y ábrelo. Docker es el programa que mantiene n8n funcionando en segundo plano.

### 2. Arranca n8n
Abre **PowerShell** en la carpeta del proyecto, `C:\ProyectosClaude\facturas`, y ejecuta:

```bash
docker compose -f n8n\docker-base\docker-compose.yml -f n8n\docker\docker-compose.override.yml up -d --build
```

Espera un minuto y abre <http://localhost:5678>. Si es la primera vez, n8n te pedirá crear tu usuario.

> Después de reiniciar el ordenador, n8n vuelve a arrancar solo cuando se abre Docker Desktop.

### 3. Conecta la IA (Gemini)
1. Consigue una clave gratuita en <https://aistudio.google.com/apikey>.
2. En n8n ve a **Overview → Credentials → Create credential** y busca **Google Gemini (PaLM) API**.
3. Pega la clave y guarda.

### 4. Crea el token de la web
La web se identifica ante n8n con un token, una contraseña larga.
1. Copia `.env.example` como `.env` y en `FACT_API_KEY=` pon una cadena larga y aleatoria. Por ejemplo, la que te da este comando de PowerShell:
   ```bash
   python -c "import secrets; print(secrets.token_urlsafe(32))"
   ```
2. En n8n crea una credencial de tipo **Header Auth** llamada `FACT API Key`, con *Name* `X-API-Key` y *Value* el mismo token.

### 5. Importa los workflows (solo si tu n8n está vacío)
En n8n: **Overview → Create → Import from file** y elige uno a uno los archivos de `n8n/workflows/`. En cada workflow:
- revisa que los nodos usan tus credenciales (Gemini, `FACT API Key` y Gmail para los avisos de error);
- pulsa **Publish** para activarlo.

Necesitarás también las tablas de datos (Data Tables) `fact_facturas`, `fact_reglas`, `fact_categorias`, `fact_errores` y `fact_recomendaciones`. Su esquema está en `CLAUDE.md`.

### 6. Abre la web
1. Haz doble clic en `web/index.html`.
2. Pulsa **Ajustes** y rellena:
   - **URL de los webhooks:** `http://localhost:5678/webhook`
   - **Token:** el de tu `.env`
3. Pulsa **Probar conexión** y después **Guardar**. Arriba debe aparecer "Conectado".

---

## Uso diario

1. **01 Sube:** arrastra tus facturas, varias a la vez si quieres. Para cada una verás la categoría, el total y el estado:
   - **Correcta:** todo cuadra.
   - **Revisar:** algo no encaja (por ejemplo, base + IVA ≠ total, o la IA tenía dudas). Aparece destacada en ámbar.
   - **Duplicada:** ya la habías subido; no se guarda dos veces.
   - **Posible duplicada:** mismo proveedor, número e importe que otra.
2. **02 Clasifica:** pasa el ratón por una factura para verla a la derecha. Con **Corregir** cambias cualquier dato. Si cambias la categoría, el sistema lo **recuerda para ese proveedor** en las siguientes facturas.
3. **03 Analiza:**
   - total del periodo y comparación con el anterior;
   - gasto recurrente al mes y al año;
   - gráficos por mes y por categoría;
   - tabla de suscripciones y contratos.
4. **04 Exporta:** recomendaciones de ahorro con el dato en el que se basan, y el botón **Exportar Excel** (`Gastos_AAAA-MM-DD.xlsx`).

Cambia el periodo con las fechas de arriba y pulsa **Aplicar**.

### Modo gestoría (varios clientes)
Pensado para que un contable lleve las facturas recibidas de varios clientes.
1. **Clientes:** arriba, **+ Cliente** da de alta a cada cliente con su NIF, su régimen de IVA (general, recargo de equivalencia, simplificado o particular) y su prorrata. Con el selector eliges con qué cliente trabajas. Al subir una factura se asigna sola al cliente cuyo NIF aparece como destinatario.
2. **Desglose fiscal:** cada factura guarda una línea por tipo de IVA, el recargo, la retención (con su «total a pagar»), los suplidos, el tipo de factura (completa, ticket o rectificativa), la operación (interior, intracomunitaria, inversión del sujeto pasivo o extracomunitaria), la cuenta PGC y el estado de pago. Las facturas en otra moneda se convierten a euros con el tipo del BCE.
3. **Avisos automáticos:**
   - NIF con dígito de control incorrecto;
   - IVA no deducible: ticket sin NIF, cliente en recargo de equivalencia, falta el número de factura;
   - deducción dudosa: restauración y viajes;
   - facturas vencidas.
4. **Trabajo en volumen:**
   - búsqueda por proveedor, NIF, número o importe;
   - orden por columna y paginación de 50, 100 o 200;
   - casillas para cambiar la categoría o la cuenta, marcar como pagadas o borrar varias a la vez;
   - **Ctrl+Z** deshace el último cambio;
   - atajos: `/` buscar, `j`/`k` moverse, `e` corregir, `x` seleccionar.
5. **04 Exporta → Trimestre fiscal:** con un cliente elegido calcula el IVA soportado del 303 por tipo (con intracomunitarias e inversión del sujeto pasivo), las retenciones 111 y 115, el 349, el 347 anual y la lista de facturas no deducibles. Desde ahí se descargan:
   - el libro registro de facturas recibidas (CSV);
   - los asientos en CSV genérico, plantilla A3 (**a validar** con una importación de prueba en A3) y compras de Holded (plantilla oficial de facturas de compra de Holded).
   - El Excel incluye también estas hojas.
6. **Pagos y banco:** importa el extracto en **Norma 43** o CSV. Cada movimiento se cruza con las facturas pendientes del cliente; al conciliar, la factura queda pagada con la fecha del movimiento.

Las cifras fiscales son una ayuda para preparar los modelos, no una presentación oficial: revísalas antes de presentar con tu programa habitual.

### Las categorías
Están en la tabla `fact_categorias` de n8n (**Overview → Data tables**). Es el único sitio donde se editan: la IA, la web y el Excel las leen de ahí.

---

## Cuando algo falla

| Síntoma | Qué hacer |
|---|---|
| La web dice "Sin conexión" | Abre Docker Desktop y comprueba que <http://localhost:5678> carga. |
| "Token no válido" | El token de Ajustes debe ser igual al de la credencial `FACT API Key`. |
| Una factura sale con estado "Error" | Normalmente la IA no respondió, porque la cuota gratuita es de unas 20 lecturas al día por modelo. Vuelve a subirla más tarde. |
| Recibes un correo "[FACT] Error en …" | Un workflow ha fallado. El correo trae el enlace a la ejecución en n8n. |
| Quieres empezar de cero | En n8n ejecuta a mano el workflow **FACT — Utilidad: vaciar fact_facturas**. |

---

## Comprobar que todo funciona

Con Python 3 instalado:

```bash
python -m venv .venv
```
```bash
.venv\Scripts\python -m pip install -r requirements.txt
```

| Script | Qué comprueba | ¿Gasta cuota de IA? |
|---|---|---|
| `tests\generar_facturas.py` | Crea 15 facturas ficticias de prueba | No |
| `tests\subir_y_comprobar.py` | Las sube (con la tabla vacía) y compara con lo esperado | Sí (14 lecturas) |
| `tests\probar_api.py` | Listado, filtros, resumen, correcciones y errores | No |
| `tests\probar_asesor.py --ultima` | Las recomendaciones guardadas | No (sin `--ultima`, 1) |
| `tests\verificar.py` | Excel = resumen = cálculo independiente; estilos y fórmulas | No |
| `tests\probar_gestoria_a.py` / `probar_gestoria_b.py` | Clientes, desglose, deducibilidad, moneda, 303/111/115/347/349, libro, asientos y banco contra un cálculo independiente | No |
| `tests\fixture_gestoria.py crear` / `borrar` | Crea y borra datos TEST de dos clientes (gestoría) | No |
| `tests\e2e` → `npx playwright test --project=escritorio --project=movil` | La web en escritorio y móvil con tu Chrome | No |
| `tests\e2e` → `npx playwright test --project=gestoria` | El modo gestoría en la web (crea y borra sus datos TEST) | No |

---

## Privacidad
- Las facturas solo se envían a Gemini para leerlas. No se mandan a ningún otro servicio.
- Los originales se guardan en tu disco, fuera de OneDrive.
- Contraseñas y claves viven en el gestor de credenciales de n8n y en tu `.env` local. Nunca van al repositorio.
- La web solo guarda en tu navegador la URL y el token.

Guía en PDF: `docs/GUIA.pdf` (se regenera desde `docs/GUIA.md` con `node tests/generar_guia_pdf.js`).
