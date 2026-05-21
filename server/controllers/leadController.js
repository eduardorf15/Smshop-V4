const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function receiveLead(req, res) {
  const email = String(req.body.email || "").trim().toLowerCase();

  if (!emailRegex.test(email)) {
    return res.status(422).json({ ok: false, message: "Informe um email válido." });
  }

  res.status(201).json({
    ok: true,
    message: "Cadastro recebido. Integre este endpoint ao seu CRM ou email marketing."
  });
}

export function receiveContact(req, res) {
  const name = String(req.body.name || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const message = String(req.body.message || "").trim();

  if (!name || !emailRegex.test(email) || message.length < 8) {
    return res.status(422).json({ ok: false, message: "Preencha nome, email e mensagem." });
  }

  res.status(201).json({
    ok: true,
    message: "Mensagem recebida. Configure um provedor SMTP para envio real em produção."
  });
}
