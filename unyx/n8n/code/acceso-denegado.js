// =============================================================
// UNYX · Verificar Cliente — Nodo "Acceso Denegado"
// El widget envía un token compartido en el cuerpo (self.crm_post no permite
// cabeceras personalizadas). Se compara contra una variable de entorno de n8n,
// no contra un valor del repositorio: el secreto nunca se versiona.
//
// Si la variable de entorno está vacía, la comparación falla y TODO se deniega
// (fail-closed): así un despliegue sin configurar no queda abierto a internet.
// =============================================================
return [{
  json: {
    ok: false,
    message: 'Acceso no autorizado. Revise el token del widget o contacte al administrador.',
  },
}];
