# Cajero Virtual v29 · Recuperación y reinicio de datos

## Abrir la aplicación

1. Extrae la carpeta `Cajero_Virtual_Web`.
2. Abre `index.html` con doble clic.
3. No necesitas instalar Python, Node.js, un servidor ni conexión a internet para utilizar la aplicación.

La entrega actual se identifica como **v29** e incluye el reinicio de datos accesible desde el inicio de sesión.

## Reglas financieras vigentes

- Depósitos: máximo **$20.000.000** por operación; el importe bruto sale de Tesorería, el cliente recibe el neto y se cobran **$20.000** por depósito. No hay tope acumulado de ahorros y la operación requiere saldo suficiente en Tesorería.
- Reparto de Tesorería: se distribuye el saldo en partes iguales y se cobran los mismos **$20.000** por cuenta que en un depósito.
- Retiros: máximo **$20.000.000** por operación; el importe retirado se acredita automáticamente a la Tesorería independiente **•••• 0004** y la comisión fija de **$50.000** se descuenta por separado.
- Transferencias: máximo **$20.000.000** por operación; el destinatario recibe el importe completo y al emisor se le cobra una comisión de **$50.000**.
- Las cuentas de clientes no tienen tope acumulado de ahorros. Los retiros y transferencias conservan sus máximos por operación de **$20.000.000**. La Tesorería no es una cuenta de ahorro, no tiene tarjeta ni créditos, y no permite transferencias manuales; su historial muestra los depósitos financiados y los retiros recibidos.
- Avances desde la tarjeta a ahorros: plazo configurable de **6 a 60 cuotas** en intervalos de 6 meses, con comisión de **$100.000**; los fondos trasladados no cuentan como otro desembolso original.
- Créditos personales: máximo **$100.000.000** por solicitud, sujetos al capital disponible del analista y al cupo autorizado del cliente.
- Saldo base configurable del analista: **$2.000.000.000** por defecto, más intereses y comisiones efectivamente cobrados, menos los créditos activos y los fondos que aún siguen en las tarjetas.
- Aumento de cupo: el importe de cada aumento se configura desde el panel; no hay máximo comercial acumulado. Al aprobarlo, los fondos pasan a la tarjeta y el avance automático traslada el saldo aprobado a ahorros después de la espera configurada; mantiene **12 cuotas al 2,00 % mensual**.
- El analista puede configurar por separado, en segundos o minutos, cuánto esperar antes de aprobar automáticamente créditos y aumentos de cupo.
- Los intervalos de pago de créditos y avances se configuran por separado, también en segundos o minutos. Todo desembolso aprobado puede avanzar automáticamente tras la espera configurada, incluso sin solicitar aumento de cupo; las cuotas empiezan desde el momento del avance.
- Deuda: cada titular mantiene como máximo una deuda activa unificada. Los pagos separan capital e intereses; el capital pagado recupera disponibilidad de avance, mientras que los intereses solo se cuentan como ganancia una vez pagados.

## Novedades v29

### Auditoría financiera

El acceso de analista incluye una sección para ejecutar comprobaciones de solo lectura. Revisa, entre otros puntos:

- Saldos de ahorro frente a los movimientos de entrada y salida registrados.
- Límites y fondos de tarjeta, exposición de crédito y deuda activa unificada por titular.
- Conciliación del capital desembolsado y reutilizado menos el capital pagado.
- Desglose de cada cuota entre capital e intereses.
- Conciliación de comisiones por operación y avance, e intereses cobrados.
- Correspondencia entre solicitudes desembolsadas y créditos registrados.
- Solicitudes pendientes duplicadas e identificadores repetidos.

Algunos datos heredados de versiones antiguas pueden mostrar una advertencia si no conservaban todo el libro de movimientos. La auditoría informa de esas diferencias; no corrige ni elimina movimientos automáticamente.

### Registro cronológico

Se conservan hasta **2.000 eventos recientes**, con fecha, tipo, titular, importe, referencia y detalles de la operación. Registra movimientos de ahorros y tarjeta, solicitudes, decisiones del analista, copias de seguridad y reinicios. No se registran los PIN en el registro de auditoría.

El registro se puede filtrar por categoría y buscar por titular, acción o referencia. El analista puede exportarlo a CSV.

### Informe financiero mensual

El analista puede seleccionar un mes y exportar un CSV con depósitos brutos y netos, retiros, transferencias, desembolsos, capital recuperado, intereses efectivamente cobrados, comisiones, cuotas, cartera pendiente y otros indicadores.

**Importante:** los movimientos, pagos e intereses reflejan el mes seleccionado. El saldo actual de ahorros y el capital pendiente son una fotografía del momento en que se genera el informe, no una reconstrucción del saldo al cierre histórico de ese mes.

### Copias de seguridad

- Exporta la base como un archivo JSON con versión de esquema e información de integridad.
- La aplicación usa SHA-256 cuando Web Crypto está disponible; si no, utiliza una suma de comprobación FNV-1a-32 para detectar corrupción accidental.
- Al importar, valida la estructura, los saldos máximos, los movimientos, los pagos y las referencias antes de pedir confirmación para sustituir los datos.
- Sigue admitiendo copias antiguas de esquema 1, que no incluyen suma de comprobación.
- Si el archivo guardado localmente parece dañado o incompleto, la aplicación bloquea nuevas escrituras para evitar sobrescribirlo silenciosamente. Recupera una copia válida o utiliza el borrado total explícito, después de confirmar.

La suma de comprobación detecta daños accidentales; **no es una firma criptográfica de origen ni protege contra una modificación deliberada**. Las copias pueden incluir saldos, movimientos y PIN de prueba: guárdalas en un lugar privado.

### Protección entre pestañas

Antes de guardar se compara la versión almacenada con la última versión leída. Las operaciones con cuadros de confirmación también verifican que la base no haya cambiado mientras el usuario decidía. Si se detecta una modificación externa, se descarta la escritura obsoleta, se recargan los datos actuales y se muestra un aviso en vez de sobrescribir silenciosamente otra operación.

Esta protección reduce conflictos comunes entre pestañas, pero el almacenamiento del navegador no es una base de datos transaccional de servidor y no garantiza atomicidad absoluta frente a todos los procesos simultáneos.

### Reinicio seguro

El botón **Borrar datos guardados** está disponible desde el inicio de sesión y exige confirmación. Elimina primero las claves de datos antiguas y después intenta guardar el estado inicial limpio; si el navegador no tiene espacio, no restaura los datos dañados.

## Organización del código

- `src/html/`: fragmentos editables de HTML por pantalla y componente.
- `css/modules/`: hojas CSS pequeñas por sección, cargadas directamente.
- `src/js/`: módulos JavaScript independientes y ordenados numéricamente. No se genera ni se incluye el antiguo `js/app.js`.
- `tools/build_modules.py`: genera `index.html` desde los fragmentos HTML y comprueba rutas, identificadores únicos, funciones duplicadas y hojas CSS idénticas.

Después de modificar los fragmentos HTML, ejecuta desde la carpeta `Cajero_Virtual_Web`:

```bash
python tools/build_modules.py
```

En Windows también puedes usar:

```bat
py tools/build_modules.py
```

Los estilos y scripts se cargan directamente desde sus módulos; no necesitan un proceso de compilación aparte. Mantén el orden numérico de los archivos JS, porque son scripts clásicos que comparten ámbito.

## Datos y límites de seguridad

Los datos se guardan en el navegador y se comparten entre pestañas del mismo perfil, mientras la selección de cuenta se mantiene por pestaña. No se sincronizan entre computadores ni entre perfiles de navegador.

Este proyecto es una simulación educativa local. No está conectado a una entidad financiera, no consulta centrales de riesgo y no debe utilizarse para administrar dinero real ni credenciales bancarias reales.


## Novedades v30: panel del analista separado por secciones

El panel del analista ahora se organiza en pantallas independientes: **Resumen, Solicitudes, Copias de seguridad, Auditoría, Informes y Registro**. La navegación mantiene el mismo diseño visual y evita mostrar todas las secciones largas a la vez.

El filtro compartido **Filtrar por cliente** afecta las solicitudes de crédito, los aumentos de cupo, las comprobaciones de auditoría asociadas a cada titular, el informe mensual y el registro cronológico. El selector conserva su valor al cambiar de sección. Las cifras del fondo del analista se mantienen globales para evitar confundir un filtro de titular con el capital total disponible.

La auditoría completa sigue ejecutándose sobre el sistema; al seleccionar un titular, la pantalla presenta las comprobaciones asociadas a ese cliente junto a unas pocas comprobaciones globales relevantes. Los informes mensuales suman los movimientos, cuotas y desembolsos de la cuenta elegida.

Al modificar fragmentos HTML, ejecuta `python tools/build_modules.py` para regenerar `index.html`. El módulo `src/js/22-analyst-pages-and-client-filter.js` controla la navegación y el selector compartido, y `css/modules/17-reviewer-sections-and-client-filter.css` contiene sus estilos.


## Novedades v31: comisión por operación y resumen acumulado del cliente

- El panel del analista muestra una tarjeta independiente para comisiones por depósitos, retiros, transferencias y avances. Cada cifra procede de los movimientos históricos registrados.
- En el informe mensual, los cuatro tipos de comisión tienen tarjetas independientes, además del total. El CSV incluye las categorías por separado.
- El filtro compartido por cliente actualiza el resumen acumulado: total pagado en cuotas, abonos y comisiones; capital amortizado; intereses cobrados; cada tipo de comisión; saldo de ahorros actual; fondos disponibles en tarjeta; capital pendiente; desembolsos originales; depósitos, retiros, transferencias y avances.
- El resumen acumulado es histórico; los saldos de ahorros, tarjeta y capital pendiente son fotografías actuales. El informe mensual continúa filtrando por titular y por mes.
- Se compactaron las tarjetas de cuenta, resumen, acciones, tarjeta bancaria y panel de analista para reducir espacio vertical, manteniendo el diseño oscuro y la legibilidad.
- El cálculo de total pagado en todo suma pagos de cuotas y abonos más comisiones de operaciones y avances. No suma depósitos, transferencias ni avances como si fueran pagos a la entidad.

El nuevo módulo `src/js/23-reviewer-client-summary-and-fees.js` calcula el resumen por cliente y llena las cuatro tarjetas globales de comisiones. Su correspondiente HTML está en `src/html/15-analyst-dashboard-and-capital.html`, y las reglas visuales nuevas para el resumen compacto están en `css/modules/18-client-financial-summary-compact.css`.


## Novedades v32: sincronización en tiempo real

Las operaciones guardadas notifican a las demás pestañas del mismo navegador mediante `BroadcastChannel`; `storage` queda como respaldo. El canal solo envía avisos, no saldos ni datos del cliente. Cada pestaña vuelve a leer la base persistida y actualiza la vista del cliente o la sección visible del analista, incluida la auditoría, el informe mensual y el registro cronológico; el filtro actual por cliente se conserva. Al volver a una pestaña suspendida se comprueba de nuevo el almacenamiento con `focus`, `pageshow` y `visibilitychange`.

El indicador muestra “En tiempo real”, “Sincronizado”, “Sincronización automática” o una advertencia si los datos no son válidos. Si otra pestaña cambia la base mientras hay una operación abierta, se cancela la escritura obsoleta en vez de sobrescribir el cambio remoto.

Para ejecutar la prueba de humo del mecanismo de actualización (solo durante desarrollo; no hace falta Node para abrir la aplicación):

```bash
node tools/test_realtime_sync.js
```

Esta prueba simula dos pestañas, confirma que cliente y analista se redibujan, que la sección de informes visible se actualiza y que un mismo aviso recibido por `BroadcastChannel` y `storage` no provoca un doble renderizado.

La sincronización funciona cuando las pestañas comparten el almacenamiento local del mismo archivo y perfil. No sincroniza entre computadores ni entre perfiles distintos, y `localStorage` no ofrece transacciones absolutas frente a escrituras simultáneas de varias pestañas.


## Novedades v33: interfaz compacta y actualización automática de créditos

### Resumen del cliente

- Se redujo el alto de la tarjeta principal de saldo, las tarjetas de estadísticas, las acciones y los movimientos recientes.
- Se ajustaron espacios, iconos, etiquetas y tamaños tipográficos para que el resumen muestre más información sin perder contraste ni legibilidad.
- En Tarjeta se redujo la altura de la tarjeta física, de los indicadores de desembolsos/disponible para avances y del formulario Realizar avance. La sección para solicitar aumento de cupo también ocupa menos espacio.
- Las reglas compactas se agregaron en `css/modules/20-client-overview-and-card-compact.css`, sin borrar los estilos base existentes.

### Estado de créditos y aumentos de cupo en tiempo real

- Cada vez que cambia la base compartida, se refrescan las solicitudes de crédito, su estado y el estado del botón de envío, incluso si la pantalla de Créditos está oculta.
- También se actualiza el historial de solicitudes de aumento de cupo, el cupo autorizado que muestra la sección y su botón de solicitud, aunque Tarjeta no sea la pantalla visible.
- Los formularios de las cuotas solo se reconstruyen cuando el cliente está viendo la pantalla Créditos, para no borrar innecesariamente un importe que estuviera escribiendo en otra sección.
- Cuando el cliente cambia a Tarjeta o Créditos, se vuelven a pintar los datos a partir de la base más reciente; no hace falta pulsar F5 ni volver a iniciar sesión.

### Mantenimiento y pruebas

- El constructor actualiza `index.html` y las rutas de los 47 módulos JavaScript sin generar un `app.js` gigante.
- La versión mostrada en la navegación y la versión incluida en las copias de seguridad pasan a `v33.0`.
- Ejecuta `node tools/test-client-credit-refresh.js` y `node tools/test_realtime_sync.js` para comprobar el refresco de solicitudes/créditos y el aviso entre pestañas.
- Abre `index.html` con doble clic para utilizar la aplicación; no se requiere servidor ni Python.


## Novedades v34: saldos en vivo en solicitudes y tarjetas en paralelo

- Las tarjetas de solicitudes de crédito y de aumento de cupo se presentan en dos columnas en escritorio y en una columna en pantallas pequeñas.
- Cada solicitud muestra una ficha compacta de estado financiero actual calculada directamente desde la base vigente: ahorros, desembolsos originales acumulados, fondos de tarjeta sin trasladar, capital recuperado, cupo autorizado y deuda pendiente total.
- Al pagar cuotas, registrar abonos, mover fondos o aprobar un desembolso, el panel del analista vuelve a leer la base compartida y presenta los saldos actuales; no se toman importes de la solicitud como si fueran balances actuales.
- Las solicitudes de aumento distinguen el cupo antes de solicitar, el cupo actual de la tarjeta y el cupo solicitado. Esto evita mostrar como actual el límite anterior una vez aprobado el aumento.
- Los estilos para la cuadrícula de solicitudes se integraron en los módulos CSS existentes para evitar añadir una hoja de sobreescrituras duplicadas.
- El constructor sigue generando `index.html` desde los fragmentos, sin bundle JavaScript duplicado.


Pruebas de regresión adicionales para v34:

```bash
node tools/test-analyst-live-card-balances.js
node tools/test-client-credit-refresh.js
node tools/test_realtime_sync.js
```

La prueba `test-analyst-live-card-balances.js` modifica en memoria los saldos, fondos de tarjeta, cupo y deuda; vuelve a renderizar las solicitudes y comprueba que las tarjetas reflejen los importes actuales, además de verificar el diseño de dos columnas para escritorio.

## Novedades v35: fondos en tarjeta y activación del crédito por avance

- Al desembolsar una solicitud, el dinero queda disponible en la tarjeta y no crea préstamos ni cuotas. Cada avance activa crédito solo por la parte trasladada a ahorros; el resto permanece en tarjeta sin generar cuotas.
- Los fondos sin avanzar ocupan cupo del cliente y capital del analista. La tarjeta más grande muestra los desembolsos cargados y los fondos que siguen disponibles.
- Los aumentos de cupo son únicamente de **$50.000.000**. El crédito de esos fondos conserva el plazo de **12 meses** y se activa con el avance.
- Las solicitudes del analista tienen pestañas separadas de **Créditos** y **Aumento de cupo**. **Copias de seguridad**, **Auditoría** e **Informes** aparecen juntas en Herramientas; el filtro por cliente queda junto a Registro.
- La vista del analista se vuelve a dibujar en el momento del desembolso. La sincronización existente también actualiza las otras pestañas abiertas.

La prueba de activación diferida se ejecuta con:

```bash
node tools/test-deferred-credit-activation.js
```

Ejecuta también el constructor y las tres pruebas de regresión listadas en la sección v34.

## Novedades v36: tarjeta sincronizada y cupo máximo claro

- Al actualizarse la tarjeta sin deuda, sus cifras de desembolsos y avances también se vuelven a dibujar correctamente.
- Los fondos de un aumento aprobado aparecen en la tarjeta y en la sección de aumentos; solo pasan a la lista de créditos cuando el cliente hace un avance.
- Se compactó la tarjeta de solicitud de aumento y, al llegar a **$500.000.000**, se ocultan los controles y se muestra un aviso claro del cupo máximo.
- Si todavía no se alcanzó exactamente el máximo pero no cabe otro incremento de **$50.000.000**, se explica que ese aumento lo superaría.

Para comprobar estos casos, ejecuta:

```bash
node tools/test-card-limit-refresh-and-max.js
node tools/test-deferred-credit-activation.js
node tools/test-analyst-live-card-balances.js
node tools/test-client-credit-refresh.js
node tools/test_realtime_sync.js
```
## Novedades v37: primer modelo de cuenta receptora

La versión intermedia v37 añadió la receptora como una cuarta cuenta de cliente. En v38 sus saldos e historial se migran a la tesorería independiente que se describe abajo; se quita el perfil de cliente que se usaba para esa función.

## Novedades v38: tesorería independiente

- La Tesorería de retiros tiene acceso propio con PIN de demostración **3456**, separado del analista y de las tres cuentas cliente.
- Los retiros de Edwin, Pedro y Reinel abonan automáticamente el importe a Tesorería. La comisión de **$20.000** sigue descontándose y registrándose por separado.
- Su cronómetro agrega **$1 por segundo** al saldo y recupera el tiempo transcurrido al volver a abrir la aplicación.
- En v38, Tesorería no tenía tarjeta ni créditos y permitía transferir fondos a una cuenta cliente; esa opción se retiró en v41. El historial actual registra depósitos financiados y retiros recibidos automáticamente.
- Los datos locales y copias de seguridad de v37 se migran conservando el saldo y el historial de la antigua cuenta receptora. Los productos de crédito asociados a ese perfil intermedio se retiran de la lista activa.
- Los avances de tarjeta permanecen limitados a **6 y 12 cuotas** en la interfaz y en la validación de la operación.

La prueba `node tools/test-withdrawal-recipient-account.js` comprueba la migración de la receptora anterior, el cobro por segundo, los retiros automáticos y la conservación separada de comisiones.


## Novedades v39: carga de Tesorería y cuotas exactas

- La pantalla independiente de Tesorería se muestra como vista raíz, fuera del panel oculto del analista.
- Los avances de créditos personales respetan el plazo elegido de **6 o 12 cuotas**, incluso cuando ya existe una deuda activa; los avances de aumento de cupo mantienen sus **12 cuotas**.
- La última cuota cubre el capital y los intereses pendientes, de modo que el crédito se cierre sin dejar pesos residuales por redondeo.
- Las pruebas de Tesorería, selección del plazo y liquidación final están en `tools/test-withdrawal-recipient-account.js`, `tools/test-deferred-credit-activation.js` y `tools/test-advance-final-installment.js`.


## Novedades v40: depósitos desde Tesorería

- Los depósitos de los clientes se financian con el saldo de Tesorería. Se descuenta de ella el importe bruto, se abona a ahorros el importe neto después de la comisión de **$20.000** y se rechaza la operación si falta saldo.
- El cronómetro de Tesorería ahora suma **$5 por segundo**. El saldo y los ingresos históricos del ritmo anterior se conservan al actualizar; la nueva tarifa solo se aplica al tiempo posterior.
- El comprobante de Tesorería y su auditoría registran cada depósito financiado.

Para verificarlo, ejecuta `node tools/test-withdrawal-recipient-account.js`; el resto de las regresiones se mantiene en las pruebas incluidas en `tools/`.


## Novedades v42: configuración de la simulación

- La configuración inicial establece una tasa mensual del **2 %**, créditos nuevos a **6 o 12 cuotas** y un cronómetro de Tesorería de **$1.000 por segundo**, sin tope acumulado. El analista puede ajustar la tasa desde Configuración.
- Se retiró la transferencia manual desde Tesorería. Los fondos siguen llegando por retiros de clientes y salen para financiar los depósitos.
- La pantalla independiente muestra el historial de depósitos financiados y retiros recibidos, con fecha e importe, y se actualiza en tiempo real.
- Se eliminaron el formulario, los validadores, los eventos y los estilos de transferencia que quedaron sin uso en la sesión de Tesorería.

## Novedades v43: automatización financiera

- Mientras exista capacidad disponible, cada cuenta recibe solicitudes aleatorias de crédito según el intervalo configurado. Tras aprobarse, el desembolso se carga a la tarjeta y pasa automáticamente a ahorros al cumplirse la espera; los plazos se eligen entre **6 y 60 cuotas**.
- Los pagos automáticos de créditos y de avances tienen intervalos independientes configurables por plazo. Si falta saldo, el sistema vuelve a intentarlo al siguiente intervalo.
- Cada hora, Tesorería distribuye en partes iguales todo el saldo que puedan recibir las tres cuentas. Se respeta el tope de ahorro de **$200.000.000** por cuenta; el saldo que no quepa por igual permanece en Tesorería.
- Las solicitudes automáticas no cambian los aumentos de cupo: siguen manuales, en incrementos de **$50.000.000** y con el máximo de tarjeta de **$500.000.000**.
- Los eventos usan marcas de tiempo reales y se recuperan al volver a abrir la app. Al ser una aplicación local sin servidor, los cambios se calculan al reabrir; no hay un proceso ejecutándose mientras el navegador está totalmente cerrado.

## Novedades v44: automatización configurable

El panel de configuración permite ajustar los intervalos de solicitudes, aprobaciones, avances y pagos. Incluye una sesión de solicitudes para revisar créditos, cupos y la cola de avances automáticos. Permite escoger plazos de 6 a 60 meses, definir rangos de montos y elegir entre avanzar el crédito completo o un monto aleatorio. Los montos se eligen en incrementos de $100.000 y siguen sujetos a los límites de capital, tarjeta y ahorros. Si el crédito supera el avance automático, el saldo restante queda en la tarjeta.

Al guardar, se reprograman los próximos eventos y la frecuencia de pago de los créditos activos. La tasa, el tope del cronómetro y los topes de aumento de cupo siguen conservando sus reglas actuales.


## Novedades v45: control de automatización

La configuración ahora tiene una sección propia del analista. Permite pausar y reanudar las solicitudes, aprobaciones, cuotas, repartos y el cronómetro de Tesorería mientras se editan parámetros. Al reanudar, los siguientes eventos se cuentan desde ese momento, sin acumular operaciones durante la pausa.

Cada intervalo puede expresarse en segundos o minutos. Al cambiar de unidad, el valor se convierte conservando la duración; los mínimos son 1 segundo y los máximos, 1 año. La pantalla conserva los campos en edición aunque reciba actualizaciones de otras pestañas. La pausa también se conserva si se cierra el navegador.


## Novedades v46: edición segura de la automatización

La configuración tiene una sección independiente en el panel del analista. El botón permite pausar y reanudar los procesos automáticos mientras se editan los parámetros; las solicitudes, aprobaciones, cuotas, repartos y el cronómetro se detienen durante la pausa. Al reanudar, los intervalos comienzan de nuevo desde ese momento. Los campos en edición se conservan aunque la app reciba actualizaciones en vivo. Cada intervalo acepta segundos o minutos, desde 1 segundo hasta 1 año.


## Novedades v47: aumentos de cupo programables y Tesorería sin tope

El panel permite configurar cada cuánto se generan solicitudes automáticas de aumento de cupo. Cada cuenta elegible solicita un incremento de **$50.000.000** cuando no tenga otra solicitud pendiente y aún esté por debajo del máximo de **$500.000.000**; la aprobación continúa en manos del analista. También se quitó el tope acumulado del cronómetro y se actualizan al abrir las Tesorerías que ya tenían el límite anterior. La configuración se reorganizó en secciones de solicitudes, pagos y plazos, montos, e interés y Tesorería.


## Novedades v48: aumentos y movimientos automáticos

- Las solicitudes automáticas de aumento de cupo se aprueban un minuto después cuando está activada la opción del analista. Se conservan los incrementos de **$50.000.000**, el máximo de **$500.000.000** y el plazo de **12 meses**.
- Se pueden configurar los intervalos en segundos o minutos para las transferencias aleatorias entre cuentas y los retiros aleatorios a Tesorería.
- Cada reparto de Tesorería descuenta **$5.000 por cuenta**; el historial registra el abono bruto y la comisión por separado para que el saldo neto concilie.
- Las comisiones de depósitos, retiros, transferencias y avances son de **$10.000**. Las comisiones de Tesorería aparecen también en los resúmenes y reportes del analista.
- Se ajustó el ancho de los selectores de plazo y modo de avance en la configuración.


## Novedades v49: saldo y cupo sin topes; aprobación configurable

- Se retiró el límite acumulado de saldo en ahorros y el máximo acumulado del cupo de tarjeta. Los incrementos siguen siendo de **$50.000.000**.
- Depósitos y repartos de Tesorería comparten la comisión de **$5.000**. Los retiros, transferencias y avances conservan sus comisiones vigentes.
- El panel permite definir por separado cuánto esperar antes de aprobar automáticamente un crédito y un aumento de cupo, en segundos o minutos. Si se desactiva la aprobación automática de cupo, la solicitud queda para revisión manual.
- Los importes siguen sujetos a la precisión exacta de enteros que admite el navegador; los máximos por operación de retiro, transferencia y depósito permanecen en **$20.000.000**.

## Novedades v50: fondo inicial del analista y comisiones agrupadas

- El saldo base predeterminado del analista ahora es de **$2.000.000.000**; el disponible se calcula con ese capital, los intereses y las comisiones cobradas, menos el capital comprometido.
- El resumen financiero agrupa en una tarjeta las comisiones por depósitos y repartos de Tesorería. Los informes mantienen el desglose de cada origen.


## Novedades v51: capital y aumentos configurables, guardado más estable

- El panel permite definir el saldo base del analista y el importe de cada aumento de cupo. Las solicitudes y aprobaciones manuales y automáticas usan el mismo importe configurado, sin tope comercial acumulado de cupo.
- Los depósitos y repartos cobran **$20.000** por operación o cuenta; las transferencias y retiros cobran **$50.000**; los avances cobran **$100.000**.
- Al cerrar la página por mucho tiempo, la recuperación automática resume historiales antiguos y conserva saldos, préstamos activos, intereses y comisiones para reducir el riesgo de superar la cuota de almacenamiento local.


## Entrega v29: recuperación desde el inicio de sesión

- El acceso de clientes incluye un botón para borrar los datos guardados y reiniciar la simulación, incluso si la base local no se pudo validar.
- El panel permite configurar cuánto espera el avance automático después de aprobarse el crédito. Durante la espera, el desembolso permanece en la tarjeta y la deuda se activa al pasar los fondos a ahorros.
- El borrado elimina primero los datos dañados y luego intenta guardar una base limpia. Si el navegador no tiene espacio, los datos previos siguen borrados y se puede volver a abrir la aplicación para crear una nueva demostración.
- La etiqueta de esta entrega es **v29**.

## Automatización protegida y avances parciales

- El panel del analista separa **Avances** de **Créditos**. Cada avance parcial aparece con su importe, plazo y fecha; el saldo que queda en la tarjeta conserva su propio reintento automático.
- La configuración inicial programa créditos cada **1 hora**, aprobación en **60 segundos**, avance en **30 segundos**, pagos de créditos y avances cada **5 minutos** para 6 cuotas y **3 minutos** para plazos de 12 a 60, y aumentos de cupo cada **24 horas** con aprobación en **60 segundos**.
- La automatización reserva **$500.000.000** del capital del analista por defecto. Créditos y aumentos pendientes también apartan fondos; cuando el capital libre no alcanza, las nuevas solicitudes esperan y se reintentan sin usar la reserva.
- Al migrar los datos existentes, la automatización queda activa y adopta estos intervalos una sola vez. Luego se pueden editar en Configuración; la reserva también se puede ajustar.
