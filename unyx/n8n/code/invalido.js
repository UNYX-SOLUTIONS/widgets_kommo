// =============================================================
// UNYX · Verificar Cliente — Nodo "Teléfono Inválido"
// Se responde 200 con ok:false para que el widget muestre el mensaje
// exacto en lugar del error genérico de red.
// =============================================================
return [{
  json: {
    ok: false,
    message: 'Ingrese 9 dígitos y seleccione un celular válido.',
  },
}];
