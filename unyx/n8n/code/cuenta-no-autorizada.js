// =============================================================
// UNYX · Verificar Cliente — Nodo "Cuenta No Autorizada"
// El widget se instala en varias cuentas de Kommo y cada una tiene su propio
// workflow. Si el widget de otra cuenta apunta aquí, se corta antes de tocar
// la API: de otro modo el asesor vería datos (y podría crear leads) en la
// cuenta equivocada usando este token.
// =============================================================
return [{
  json: {
    ok: false,
    message: 'Este widget no está configurado para esta cuenta de Kommo. Revise la URL de n8n en los ajustes del widget.',
  },
}];
