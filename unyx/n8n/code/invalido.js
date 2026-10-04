// =============================================================
// UNYX · Verificar Cliente — Nodo "Teléfono Inválido"
//
// Solo se llega aquí si el teléfono no tiene forma de número: letras, o una
// longitud imposible. La validación por país (los 9 dígitos de celular en
// Ecuador, de 6 a 12 en el resto) la hace "Preparar Consultas" con el país que
// manda el widget.
// =============================================================
return [{
  json: {
    ok: false,
    message: 'Ingrese un número de teléfono válido.',
  },
}];
