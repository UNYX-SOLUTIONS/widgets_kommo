// =============================================================
// UNYX · Verificar Cliente — Nodo "Acceso Denegado"
//
// El nodo "¿Autorizado?" ya comprobó el token del widget y la cuenta; aquí
// sólo se arma la respuesta. Un solo nodo cubre los dos motivos posibles:
// token que no corresponde, o widget instalado en la cuenta equivocada.
// =============================================================
return [{
  json: {
    ok: false,
    message: 'Acceso no autorizado. El token del widget no es el de esta cuenta o el widget está mal configurado.',
  },
}];
