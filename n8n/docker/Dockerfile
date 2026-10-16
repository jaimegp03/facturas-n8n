# n8n con ExcelJS disponible para los Code nodes (FACT — Exportar Excel).
FROM docker.n8n.io/n8nio/n8n:2.42.5

USER root
# Instalación global: el task runner resuelve los módulos subiendo hasta
# /usr/local/lib/node_modules, donde queda exceljs.
RUN npm install -g exceljs@4.4.0 && npm cache clean --force
USER node
