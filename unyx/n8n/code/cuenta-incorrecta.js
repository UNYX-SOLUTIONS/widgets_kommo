// =============================================================
// UNYX · Verificar Cliente — Nodo "Cuenta Incorrecta"
//
// El token corresponde a este cliente, pero el widget está instalado en otra
// cuenta de Kommo (o mal configurado). Se corta aquí: si siguiera, el asesor
// vería datos y crearía leads en la cuenta equivocada con este token.
// =============================================================
return [{
  json: {
    ok: false,
    message: 'El token no corresponde a esta cuenta de Kommo. Revise la configuración del widget.',
  },
}];
