  async function registerLimitIncreaseDecision(requestId, decision) {
    if (typeof catchUpAutomaticEventsBeforeOperation === 'function' && !catchUpAutomaticEventsBeforeOperation()) return;
    if (!reviewerSession || !['Aprobado', 'Rechazado'].includes(decision)) return;
    const request = (db.limitIncreaseRequests || []).find((item) => item.id === requestId);
    if (!request || (request.status || 'En revisión') !== 'En revisión') {
      showToast('Esta solicitud ya fue atendida.', 'error');
      return;
    }

    const transactionRevision = captureDatabaseRevision();
    const target = db.accounts[request.accountId];
    if (!target) {
      showToast('No se encontró la cuenta asociada a la solicitud.', 'error');
      return;
    }
    const currentLimit = cardCreditLimitForAccount(request.accountId);
    const increaseAmount = roundMoney(Number(request.increaseAmount) > 0 ? request.increaseAmount : request.requestedLimit - Number(request.previousLimit ?? currentLimit));
    if (decision === 'Aprobado') {
      if (!Number.isSafeInteger(increaseAmount) || increaseAmount <= 0 || request.requestedLimit !== currentLimit + increaseAmount || request.requestedLimit > MAX_CARD_LIMIT) {
        await showAppDialog({ type: 'alert', title: 'No se puede aprobar el cupo', message: 'El aumento debe ser positivo y el nuevo cupo debe mantenerse dentro de la precisión numérica segura del simulador.', eyebrow: 'VALIDACIÓN DE CUPO', icon: '!', confirmText: 'Entendido', danger: true });
        return;
      }
      const analystAvailable = availableAnalystCapital();
      if (increaseAmount > analystAvailable) {
        await showAppDialog({ type: 'alert', title: 'Fondo insuficiente para desembolsar', message: `Cargar ${money(increaseAmount)} a la tarjeta requiere más capital del disponible. El analista tiene ${money(analystAvailable)} disponibles.`, eyebrow: 'FONDO DEL ANALISTA', icon: '!', confirmText: 'Entendido', danger: true });
        return;
      }
      const exposure = outstandingCreditExposureForAccount(request.accountId);
      if (exposure + increaseAmount > request.requestedLimit) {
        await showAppDialog({ type: 'alert', title: 'El desembolso supera el cupo', message: `La deuda pendiente es ${money(exposure)}. Al desembolsar ${money(increaseAmount)}, la exposición quedaría en ${money(exposure + increaseAmount)}, por encima del nuevo cupo ${money(request.requestedLimit)}.`, eyebrow: 'VALIDACIÓN DE CUPO', icon: '!', confirmText: 'Entendido', danger: true });
        return;
      }
      const availableOnCard = availableAdvancesForCard(target.card);
      if (availableOnCard + increaseAmount > request.requestedLimit) {
        await showAppDialog({ type: 'alert', title: 'Fondos de tarjeta por encima del tope', message: `El desembolso automático de ${money(increaseAmount)} superaría el límite solicitado de ${money(request.requestedLimit)}.`, eyebrow: 'VALIDACIÓN DE TARJETA', icon: '!', confirmText: 'Entendido', danger: true });
        return;
      }
    }

    const confirmed = await showAppDialog({
      type: 'confirm',
      title: decision === 'Aprobado' ? 'Aprobar aumento de cupo' : 'Rechazar solicitud de cupo',
      message: decision === 'Aprobado'
        ? `¿Apruebas aumentar el cupo de ${target.name} en ${money(increaseAmount)}, de ${money(currentLimit)} a ${money(request.requestedLimit)}? La diferencia se cargará a su tarjeta. El crédito y sus cuotas a 12 meses solo se activarán cuando el cliente realice avances.`
        : `¿Confirmas rechazar el aumento de cupo solicitado por ${target.name}? No se realizará ningún desembolso.`,
      eyebrow: 'REVISIÓN DE CUPO',
      icon: decision === 'Aprobado' ? '✓' : '!',
      confirmText: decision === 'Aprobado' ? 'Aprobar aumento' : 'Rechazar solicitud',
      danger: decision === 'Rechazado'
    });
    if (!confirmed) return;
    if (!isDatabaseRevisionCurrent(transactionRevision)) { abortStaleFinancialOperation(); return; }

    const note = await showAppDialog({ type: 'prompt', title: 'Nota de decisión', message: 'Puedes dejar una observación breve para el expediente.', eyebrow: 'REGISTRO DE REVISIÓN', icon: '✎', confirmText: 'Guardar decisión', defaultValue: request.reviewerNote || '', inputLabel: 'Observación del analista' });
    if (note === null) return;
    if (!isDatabaseRevisionCurrent(transactionRevision)) { abortStaleFinancialOperation(); return; }

    const decisionDate = new Date().toISOString();
    request.status = decision;
    request.reviewerName = REVIEWER_NAME;
    request.reviewerNote = note.slice(0, 500);
    request.reviewedAt = decisionDate;

    if (decision === 'Aprobado') {
      target.card = target.card || { number: target.cardNumber, limit: MAX_CARD_FUNDS, funds: 0, recoveredFunds: 0, debt: 0, nextInterestDate: null, history: [], pendingDisbursements: [] };
      target.card.limit = roundMoney(request.requestedLimit);
      const rate = currentMonthlyInterestRate();
      const estimate = calculateCreditEstimate(increaseAmount, 12, rate);
      const automaticApplication = {
        id: createId(),
        accountId: request.accountId,
        applicantName: target.name,
        accountNumber: target.accountNumber,
        amount: increaseAmount,
        monthlyIncome: 0,
        termMonths: 12,
        monthlyRate: rate,
        employment: 'Aumento de cupo',
        purpose: `Desembolso automático por aumento de cupo (${money(currentLimit)} a ${money(request.requestedLimit)})`,
        monthlyPayment: estimate.monthlyPayment,
        totalPayable: estimate.totalPayable,
        totalInterest: estimate.totalInterest,
        status: 'Aprobado',
        date: decisionDate,
        reviewedAt: decisionDate,
        disbursedAt: decisionDate,
        reviewerName: REVIEWER_NAME,
        reviewerNote: note.slice(0, 500),
        origin: 'Aumento de cupo',
        limitIncreaseRequestId: request.id,
        autoAdvanceEnabled: true,
        autoAdvanceAt: new Date(Date.now() + simulationSettingsFor(db).automaticAdvanceDelaySeconds * 1000).toISOString()
      };
      automaticApplication.activatedAmount = 0;
      automaticApplication.cardFundsRemaining = 0;
      if (!Array.isArray(db.creditApplications)) db.creditApplications = [];
      db.creditApplications.unshift(automaticApplication);
      if (!queueCardDisbursement(request.accountId, automaticApplication, increaseAmount)) {
        showToast('No se pudo registrar el aumento desembolsado en la tarjeta.', 'error');
        return;
      }
      target.card.funds = roundMoney(target.card.funds + increaseAmount);
      recordCardMovement(request.accountId, 'card_disbursement', increaseAmount, `Desembolso automático por aumento de cupo ${String(request.id).slice(-7)}; crédito pendiente de avance`, 'in');
      recordMovement(request.accountId, 'card_disbursement', increaseAmount, 'Aumento de cupo acreditado a fondos de tarjeta; aún no activa crédito ni cuotas', null);
      automaticApplication.loanId = null;
      request.approvedLimit = target.card.limit;
      request.disbursedAmount = increaseAmount;
      request.disbursedAt = decisionDate;
      request.loanId = null;
      request.creditApplicationId = automaticApplication.id;
      request.cardFundsRemaining = increaseAmount;
      request.activatedAmount = 0;
      recordAuditEvent('Aumento de cupo aprobado y fondos desembolsados a tarjeta', { category: 'cupo', accountId: request.accountId, amount: increaseAmount, source: 'Analista', referenceId: request.id, description: `Nuevo cupo ${money(request.requestedLimit)}; crédito pendiente de avance`, details: { previousLimit: currentLimit, approvedLimit: target.card.limit, loanActivated: false, cardFundsRemaining: increaseAmount, termMonths: 12 } });
    } else {
      request.approvedLimit = null;
      request.disbursedAmount = 0;
      recordAuditEvent('Solicitud de aumento de cupo rechazada', { category: 'cupo', accountId: request.accountId, amount: increaseAmount, source: 'Analista', referenceId: request.id, description: `Cupo solicitado ${money(request.requestedLimit)}`, details: { note: request.reviewerNote } });
    }

    if (!saveDatabase()) { renderReviewerDashboard(); return; }
    renderReviewerDashboard();
    showToast(decision === 'Aprobado'
      ? `Cupo aumentado a ${money(target.card.limit)}. Se cargaron ${money(increaseAmount)} a la tarjeta de ${target.name}; el crédito y las cuotas a 12 meses se activarán con los avances.`
      : 'Solicitud de aumento de cupo rechazada. No se realizó ningún desembolso.');
  }
