  async function submitCardPayment(event) {
    event.preventDefault();
    if (typeof catchUpAutomaticEventsBeforeOperation === 'function' && !catchUpAutomaticEventsBeforeOperation()) return;
    const current = account();
    if (!current) return;
    const rawAmount = Number($('#cardPaymentAmount').value);
    const amount = roundMoney(rawAmount);
    clearCardFormError('cardPayment');
    if (!validIntegerAmount(rawAmount)) return cardFormProblem('cardPayment', 'Ingresa un importe entero mayor que cero, sin decimales.');
    if (amount > current.balance) return cardFormProblem('cardPayment', `Ahorros insuficientes. Saldo disponible: ${money(current.balance)}.`);
    if (amount > current.card.debt) return cardFormProblem('cardPayment', `El pago no puede superar la deuda actual de la tarjeta: ${money(current.card.debt)}.`);
    const transactionRevision = captureDatabaseRevision();
    const confirmed = await showAppDialog({
      type: 'confirm', title: 'Pagar tarjeta desde ahorros',
      message: `Se descontarán ${money(amount)} de tus ahorros para reducir la deuda de tarjeta. Ahorros después del pago: ${money(current.balance - amount)}.`,
      eyebrow: 'PAGO DE TARJETA', icon: '✓', confirmText: 'Confirmar pago'
    });
    if (!confirmed) return;
    if (!isDatabaseRevisionCurrent(transactionRevision)) { abortStaleFinancialOperation(); return; }
    current.balance = roundMoney(current.balance - amount);
    current.card.debt = Math.max(0, roundMoney(current.card.debt - amount));
    if (current.card.debt === 0) current.card.nextInterestDate = null;
    recordMovement(activeAccountId, 'card_payment', amount, 'Pago de tarjeta desde cuenta de ahorros', 'out');
    recordCardMovement(activeAccountId, 'card_payment', amount, 'Pago de tarjeta recibido desde ahorros', 'in');
    if (!saveDatabase()) { renderApp(); return; }
    $('#cardPaymentForm').reset();
    renderApp();
    showToast(`Saldo antiguo de tarjeta pagado por ${money(amount)}.`);
  }

  function submitCardLimitIncreaseRequest(event) {
    event.preventDefault();
    if (typeof catchUpAutomaticEventsBeforeOperation === 'function' && !catchUpAutomaticEventsBeforeOperation()) return;
    const current = account();
    if (!current) return;
    const error = $('#cardLimitRequestError');
    error.hidden = true;
    const currentLimit = cardCreditLimitForAccount(current.id);
    const increaseAmount = Number($('#cardLimitRequestedValue').value);
    const allowedIncreaseAmounts = [simulationSettingsFor(db).limitIncreaseAmount];
    const requestedLimit = roundMoney(currentLimit + increaseAmount);
    if (!allowedIncreaseAmounts.includes(increaseAmount) || requestedLimit > MAX_CARD_LIMIT) {
      error.textContent = `El aumento configurado es de ${money(allowedIncreaseAmounts[0])} y el cupo debe mantenerse dentro de la precisión numérica segura del simulador.`;
      error.hidden = false;
      $('#cardLimitRequestedValue').focus();
      return;
    }
    const existingPending = (db.limitIncreaseRequests || []).some((request) => request.accountId === current.id && (request.status || 'En revisión') === 'En revisión');
    if (existingPending) {
      error.textContent = 'Ya tienes una solicitud de aumento de cupo pendiente de revisión.';
      error.hidden = false;
      return;
    }
    if (!allowedIncreaseAmounts.some((value) => currentLimit + value <= MAX_CARD_LIMIT)) {
      error.textContent = `Tu tarjeta no puede recibir ese aumento sin superar el rango numérico seguro del simulador.`;
      error.hidden = false;
      return;
    }
    const request = {
      id: createId(), accountId: current.id, applicantName: current.name, accountNumber: current.accountNumber,
      previousLimit: currentLimit, increaseAmount, requestedLimit, termMonths: 12, status: 'En revisión', date: new Date().toISOString(),
      autoApprovalAt: new Date(Date.now() + simulationSettingsFor(db).automaticLimitIncreaseApprovalDelaySeconds * 1000).toISOString()
    };
    if (!Array.isArray(db.limitIncreaseRequests)) db.limitIncreaseRequests = [];
    db.limitIncreaseRequests.unshift(request);
    recordAuditEvent('Solicitud de aumento de cupo enviada', { category: 'cupo', accountId: current.id, amount: increaseAmount, source: 'Cliente', referenceId: request.id, description: `Nuevo cupo solicitado: ${money(requestedLimit)}`, details: { previousLimit: currentLimit, requestedLimit, termMonths: 12 } });
    if (!saveDatabase()) { renderApp(); return; }
    renderCardLimitRequestSection(current);
    if (reviewerSession) renderReviewerDashboard();
    showToast(`Solicitud de aumento de ${money(increaseAmount)} enviada. Nuevo cupo propuesto: ${money(requestedLimit)}. El crédito se activará a 12 cuotas solo al realizar avances si se aprueba.`);
  }
