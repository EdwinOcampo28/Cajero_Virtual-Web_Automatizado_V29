  async function registerCreditDecision(applicationId, decision) {
    if (typeof catchUpAutomaticEventsBeforeOperation === 'function' && !catchUpAutomaticEventsBeforeOperation()) return;
    if (!reviewerSession || !['Aprobado', 'Rechazado', 'Desembolsar'].includes(decision)) return;
    const application = (db.creditApplications || []).find((item) => item.id === applicationId);
    if (!application) return;
    if (application.automaticSimulation === true) { showToast('Esta solicitud se aprobará automáticamente tras el tiempo configurado en el panel de simulación.', 'error'); return; }
    const oldApprovedWithoutLoan = application.status === 'Aprobado' && !findLoanForApplication(application.id);
    const isLegacyDisbursement = decision === 'Desembolsar' && oldApprovedWithoutLoan && !application.disbursedAt && !(Number(application.cardFundsRemaining) > 0);
    if (decision === 'Desembolsar' && !isLegacyDisbursement) return;
    if (decision !== 'Desembolsar' && (application.status || 'En revisión') !== 'En revisión') {
      showToast('Esta solicitud ya tiene una decisión registrada.', 'error');
      return;
    }
    const transactionRevision = captureDatabaseRevision();
    const targetAccount = db.accounts[application.accountId];
    if (decision === 'Aprobado' || decision === 'Desembolsar') {
      targetAccount.card = targetAccount.card || { number: targetAccount.cardNumber, limit: MAX_CARD_FUNDS, funds: 0, recoveredFunds: 0, debt: 0, nextInterestDate: null, history: [], pendingDisbursements: [] };
      if (!Number.isFinite(targetAccount.card.recoveredFunds)) targetAccount.card.recoveredFunds = 0;
      const poolAvailable = availableAnalystCapital();
      const personalExposure = outstandingCreditExposureForAccount(application.accountId);
      if (application.amount > poolAvailable) {
        await showAppDialog({
          type: 'alert',
          title: 'Fondo de crédito insuficiente',
          message: `El analista administra ${money(simulationSettingsFor(db).analystCapital)} de capital base y tiene ${money(poolAvailable)} disponibles. Esta solicitud es por ${money(application.amount)}.`,
          eyebrow: 'FONDO DEL ANALISTA', icon: '!', confirmText: 'Entendido', danger: true
        });
        return;
      }
      const personalCardLimit = cardCreditLimitForAccount(application.accountId);
      if (personalExposure + application.amount > personalCardLimit) {
        await showAppDialog({
          type: 'alert',
          title: 'Tope de crédito del titular',
          message: `El cupo autorizado de esta tarjeta es ${money(personalCardLimit)}. Esta cuenta tiene ${money(personalExposure)} pendientes y solo puede recibir ${money(availablePersonalCreditForAccount(application.accountId))} más.`,
          eyebrow: 'TOPE POR TARJETA', icon: '!', confirmText: 'Entendido', danger: true
        });
        return;
      }
      if (availableAdvancesForCard(targetAccount.card) + application.amount > cardLimitForRecord(targetAccount.card)) {
        await showAppDialog({
          type: 'alert',
          title: 'Fondos de tarjeta por encima del tope',
          message: `Los fondos sin trasladar de esta tarjeta superarían su cupo autorizado de ${money(cardLimitForRecord(targetAccount.card))}. Traslada parte a ahorros antes de desembolsar otro crédito.`,
          eyebrow: 'TOPE DE FONDOS DE TARJETA', icon: '!', confirmText: 'Entendido', danger: true
        });
        return;
      }
    }
    const confirmText = decision === 'Rechazado'
      ? '¿Confirmas rechazar esta solicitud de crédito? No se realizará ningún desembolso.'
      : `¿Confirmas aprobar y cargar ${money(application.amount)} a la tarjeta de crédito de ${application.applicantName || targetAccount.name}? Los fondos quedarán disponibles en la tarjeta. No se generará un crédito ni cuotas hasta que el cliente traslade fondos a sus ahorros mediante un avance.`;
    const approved = await showAppDialog({
      type: 'confirm',
      title: decision === 'Rechazado' ? 'Rechazar solicitud' : 'Aprobar desembolso a tarjeta',
      message: confirmText,
      eyebrow: 'DECISIÓN DEL ANALISTA',
      icon: decision === 'Rechazado' ? '!' : '✓',
      confirmText: decision === 'Rechazado' ? 'Rechazar solicitud' : 'Aprobar desembolso',
      danger: decision === 'Rechazado'
    });
    if (!approved) return;
    if (!isDatabaseRevisionCurrent(transactionRevision)) { abortStaleFinancialOperation(); return; }
    const note = await showAppDialog({
      type: 'prompt',
      title: 'Nota de decisión',
      message: 'Añade una observación breve para dejar constancia en el expediente. Este campo es opcional.',
      eyebrow: 'REGISTRO DE REVISIÓN',
      icon: '✎',
      confirmText: 'Guardar decisión',
      defaultValue: application.reviewerNote || '',
      inputLabel: 'Observación del analista'
    });
    if (note === null) return;
    if (!isDatabaseRevisionCurrent(transactionRevision)) { abortStaleFinancialOperation(); return; }

    application.reviewerName = REVIEWER_NAME;
    application.reviewerNote = note.trim().slice(0, 500);
    application.reviewedAt = application.reviewedAt || new Date().toISOString();
    if (decision === 'Rechazado') {
      application.status = 'Rechazado';
      application.reviewerDecision = 'Rechazado';
      recordAuditEvent('Solicitud de crédito rechazada', { category: 'creditos', accountId: application.accountId, amount: application.amount, source: 'Analista', referenceId: application.id, description: application.purpose || 'Solicitud de crédito', details: { note: application.reviewerNote } });
    } else {
      targetAccount.card.funds = roundMoney(targetAccount.card.funds + application.amount);
      application.disbursedAt = new Date().toISOString();
      application.activatedAmount = 0;
      application.cardFundsRemaining = 0;
      if (!queueCardDisbursement(application.accountId, application, application.amount)) {
        showToast('No se pudo registrar el desembolso pendiente en la tarjeta.', 'error');
        return;
      }
      recordCardMovement(application.accountId, 'card_disbursement', application.amount, 'Desembolso cargado a fondos de tarjeta; crédito pendiente de avance', 'in');
      application.status = 'Aprobado';
      application.autoAdvanceEnabled = true;
      application.autoAdvanceAt = new Date(Date.now() + simulationSettingsFor(db).automaticAdvanceDelaySeconds * 1000).toISOString();
      application.reviewerDecision = 'Aprobado';
      application.loanId = null;
      recordMovement(application.accountId, 'card_disbursement', application.amount, 'Desembolso acreditado a fondos de tarjeta; aún no activa crédito ni cuotas', null);
      recordAuditEvent('Crédito aprobado y fondos desembolsados a tarjeta', { category: 'creditos', accountId: application.accountId, amount: application.amount, source: 'Analista', referenceId: application.id, description: 'Fondos disponibles en tarjeta; crédito y cuotas se activan al realizar un avance', details: { loanActivated: false, cardFundsRemaining: application.amount } });
    }
    if (!saveDatabase()) { renderReviewerDashboard(); return; }
    renderReviewerDashboard();
    showToast(decision === 'Rechazado' ? 'Solicitud rechazada. No se desembolsó dinero.' : `Desembolso cargado a la tarjeta: ${money(application.amount)}. No hay crédito ni cuotas activas hasta realizar un avance.`);
  }
