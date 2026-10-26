  // Snapshot de saldos leídos de la base actual cada vez que se dibuja una solicitud.
  // No se reutilizan importes guardados en la solicitud, porque representan valores históricos.
  function getReviewerLiveClientBalanceSnapshot(accountId) {
    const id = Number(accountId);
    const client = db?.accounts?.[id];
    if (!client) return null;
    const card = client.card || {};
    const loans = (Array.isArray(db.loans) ? db.loans : [])
      .filter((loan) => Number(loan.accountId) === id && Number(loan.outstandingPrincipal) > 0 && loan.status !== 'Pagado')
      .sort((a, b) => new Date(a.disbursedAt || 0) - new Date(b.disbursedAt || 0));
    const debt = typeof outstandingCreditExposureForAccount === 'function'
      ? outstandingCreditExposureForAccount(id)
      : roundMoney(loans.reduce((sum, loan) => sum + Math.max(0, Number(loan.outstandingPrincipal) || 0), 0) + Math.max(0, Number(card.debt) || 0));
    const totalDisbursed = typeof totalDisbursedForAccount === 'function'
      ? totalDisbursedForAccount(id)
      : roundMoney(loans.reduce((sum, loan) => sum + Math.max(0, Number(loan.originalDisbursedTotal ?? loan.principalOriginal) || 0), 0));
    return {
      balance: Math.max(0, roundMoney(Number(client.balance) || 0)),
      totalDisbursed,
      cardFunds: Math.max(0, roundMoney(Number(card.funds) || 0)),
      recoveredFunds: Math.max(0, roundMoney(Number(card.recoveredFunds) || 0)),
      availableAdvances: typeof availableAdvancesForCard === 'function'
        ? availableAdvancesForCard(card)
        : Math.max(0, roundMoney((Number(card.funds) || 0) + (Number(card.recoveredFunds) || 0))),
      cardLimit: typeof cardCreditLimitForAccount === 'function'
        ? cardCreditLimitForAccount(id)
        : Math.max(0, roundMoney(Number(card.limit) || 0)),
      outstandingDebt: debt,
      activeLoan: loans[0] || null
    };
  }

  function appendReviewerLiveClientBalanceSnapshot(cardElement, accountId) {
    const snapshot = getReviewerLiveClientBalanceSnapshot(accountId);
    if (!snapshot) return;
    const panel = document.createElement('section');
    panel.className = 'reviewer-live-client-balance';
    panel.setAttribute('aria-label', 'Saldos actuales del cliente');
    const heading = document.createElement('div');
    heading.className = 'reviewer-live-client-balance-heading';
    heading.textContent = 'Saldos actuales del cliente';
    const grid = document.createElement('div');
    grid.className = 'reviewer-live-client-balance-grid';
    const metrics = [
      ['Saldo de ahorros', snapshot.balance],
      ['Desembolsos originales', snapshot.totalDisbursed],
      ['Disponible en tarjeta', snapshot.availableAdvances],
      ['Fondos sin trasladar', snapshot.cardFunds],
      ['Capital recuperado', snapshot.recoveredFunds],
      ['Cupo autorizado', snapshot.cardLimit],
      ['Deuda pendiente total', snapshot.outstandingDebt]
    ];
    metrics.forEach(([label, amount]) => {
      const cell = document.createElement('div');
      cell.className = 'reviewer-live-client-balance-cell';
      const caption = document.createElement('span');
      caption.textContent = label;
      const value = document.createElement('strong');
      value.textContent = money(amount);
      cell.append(caption, value);
      grid.append(cell);
    });
    panel.append(heading, grid);
    cardElement.append(panel);
  }

  function renderReviewerApplications() {
    if (!reviewerSession || !reviewerApplicationsList) return;
    const selectedClientId = getReviewerSelectedClientId();
    const allApplications = (Array.isArray(db.creditApplications) ? db.creditApplications : [])
      .filter((item) => item.origin !== 'Aumento de cupo')
      .filter((item) => selectedClientId === null || Number(item.accountId) === selectedClientId);
    const filter = reviewerFilter.value;
    const applications = allApplications.filter((item) => {
      const status = item.status || 'En revisión';
      if (filter === 'pending') return status === 'En revisión';
      if (filter === 'approved') return ['Aprobado', 'Desembolsado', 'Pagado'].includes(status);
      if (filter === 'rejected') return status === 'Rechazado';
      return true;
    });
    reviewerApplicationsList.replaceChildren();
    $('#reviewerEmptyState').hidden = applications.length > 0;
    reviewerApplicationsList.hidden = applications.length === 0;

    applications.forEach((item) => {
      const card = document.createElement('article');
      card.className = 'reviewer-application-card';
      const heading = document.createElement('div');
      heading.className = 'reviewer-card-heading';
      const applicant = document.createElement('div');
      applicant.className = 'reviewer-applicant';
      const name = document.createElement('h3');
      name.textContent = item.applicantName || db.accounts[item.accountId]?.name || 'Cliente';
      const accountLine = document.createElement('p');
      accountLine.textContent = `Cuenta •••• ${(item.accountNumber || db.accounts[item.accountId]?.accountNumber || '').replace(/\s/g, '').slice(-4)} · Solicitud ${String(item.id).slice(-7)}`;
      const requested = document.createElement('strong');
      requested.className = 'reviewer-requested-amount';
      requested.textContent = money(item.origin === 'Aumento de cupo' && Number(item.activatedAmount) > 0 ? item.activatedAmount : item.amount);
      applicant.append(name, accountLine);
      const status = document.createElement('span');
      status.className = `credit-status ${statusClass(item.status || 'En revisión')}`;
      status.textContent = item.status || 'En revisión';
      heading.append(applicant, requested, status);

      const details = document.createElement('div');
      details.className = 'reviewer-detail-grid';
      const liveSnapshot = getReviewerLiveClientBalanceSnapshot(item.accountId);
      const relatedLoan = findLoanForApplication(item.id) || null;
      const isLimitIncreaseDisbursement = item.origin === 'Aumento de cupo';
      const detailRows = [
        [isLimitIncreaseDisbursement ? 'Tipo de operación' : 'Ingresos mensuales declarados', isLimitIncreaseDisbursement ? 'Desembolso automático por aumento de cupo' : money(item.monthlyIncome || 0)],
        [relatedLoan ? 'Cuota vigente' : 'Cuota estimada al activar', money(relatedLoan?.monthlyPayment || item.monthlyPayment || 0)],
        ['Plazo', `${item.termMonths || 0} meses`],
        ['Tasa mensual de la solicitud', `${((Number.isFinite(item.monthlyRate) ? item.monthlyRate : currentMonthlyInterestRate()) * 100).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`],
        ...(!isLimitIncreaseDisbursement ? [['Situación laboral', item.employment || 'No indicada']] : []),
        ['Destino', item.purpose || 'No indicado'],
        ['Total estimado de la solicitud', money(item.totalPayable || 0)],
        ['Fecha de solicitud', shortDateTime(item.date)],
        ...(Number(item.cardFundsRemaining) > 0 ? [['Fondos aún en tarjeta', money(item.cardFundsRemaining)]] : []),
        ...(Number(item.cardFundsRemaining) > 0 ? [['Estado de cuotas', 'No se generan sobre fondos aún no avanzados']] : []),
        ...(liveSnapshot?.outstandingDebt > 0 ? [['Capital/deuda pendiente actual', money(liveSnapshot.outstandingDebt)]] : []),
        ...(relatedLoan ? [['Cuota vigente', money(relatedLoan.monthlyPayment || item.monthlyPayment || 0)], ['Estado del crédito', relatedLoan.status], ['Cuotas pagadas', `${relatedLoan.installmentsPaid || 0} de ${relatedLoan.termMonths || item.termMonths || 0}`]] : [])
      ];
      detailRows.forEach(([label, value]) => {
        const cell = document.createElement('div');
        cell.className = 'reviewer-detail-cell';
        const caption = document.createElement('span');
        caption.textContent = label;
        const content = document.createElement('strong');
        content.textContent = value;
        cell.append(caption, content);
        details.append(cell);
      });

      card.append(heading);
      if (item.automaticSimulation === true && (item.status || 'En revisión') === 'En revisión') {
        const automaticNotice = document.createElement('p');
        automaticNotice.className = 'reviewer-decision-meta';
        automaticNotice.textContent = `Aprobación automática programada para ${shortDateTime(item.autoApprovalAt)}; el desembolso pasará a ahorros y generará cuotas al avanzar.`;
        card.append(automaticNotice);
      }
      appendReviewerLiveClientBalanceSnapshot(card, item.accountId);
      card.append(details);
      if (item.reviewedAt) {
        const reviewed = document.createElement('p');
        reviewed.className = 'reviewer-decision-meta';
        reviewed.textContent = `Decisión registrada el ${shortDateTime(item.reviewedAt)} por ${item.reviewerName || REVIEWER_NAME}.`;
        card.append(reviewed);
      }
      if (item.reviewerNote) {
        const note = document.createElement('p');
        note.className = 'reviewer-existing-note';
        note.textContent = `Nota del analista: ${item.reviewerNote}`;
        card.append(note);
      }
      const normalizedStatus = item.status || 'En revisión';
      const needsLegacyDisbursement = normalizedStatus === 'Aprobado' && !relatedLoan && !item.disbursedAt && !(Number(item.cardFundsRemaining) > 0);
      if ((normalizedStatus === 'En revisión' || needsLegacyDisbursement) && item.automaticSimulation !== true) {
        const actions = document.createElement('div');
        actions.className = 'reviewer-card-actions';
        const approve = document.createElement('button');
        approve.type = 'button';
        approve.className = 'button button-primary reviewer-approve-button';
        approve.dataset.reviewId = item.id;
        approve.dataset.reviewDecision = normalizedStatus === 'Aprobado' ? 'Desembolsar' : 'Aprobado';
        approve.textContent = normalizedStatus === 'Aprobado' ? 'Completar desembolso a tarjeta' : 'Aprobar y cargar a tarjeta';
        actions.append(approve);
        if (normalizedStatus === 'En revisión') {
          const reject = document.createElement('button');
          reject.type = 'button';
          reject.className = 'button button-secondary reviewer-reject-button';
          reject.dataset.reviewId = item.id;
          reject.dataset.reviewDecision = 'Rechazado';
          reject.textContent = 'Rechazar solicitud';
          actions.append(reject);
        }
        card.append(actions);
      }
      reviewerApplicationsList.append(card);
    });
  }
