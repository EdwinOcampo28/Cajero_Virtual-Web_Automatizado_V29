  function pendingAutomaticAdvanceAmount(application) {
    const fromApplication = Math.max(0, Number(application?.cardFundsRemaining) || 0);
    const pending = db.accounts?.[application?.accountId]?.card?.pendingDisbursements;
    const entry = Array.isArray(pending) ? pending.find((item) => item.applicationId === application.id) : null;
    return Math.max(fromApplication, Math.max(0, Number(entry?.remainingAmount) || 0));
  }

  function reviewerAutomaticAdvanceCard(application, pending, advanceEvent = null) {
    const account = db.accounts?.[application.accountId];
    const name = application.applicantName || account?.name || 'Cliente';
    const amount = advanceEvent
      ? Math.max(0, Number(advanceEvent.amount) || 0)
      : (pending ? pendingAutomaticAdvanceAmount(application) : Math.max(0, Number(application.activatedAmount) || 0));
    const accumulated = Math.max(0, Number(application.activatedAmount) || 0);
    const date = advanceEvent?.date || (pending ? application.autoAdvanceAt : (application.autoAdvancedAt || application.lastAdvancedAt));
    const term = Number(advanceEvent?.details?.termMonths || (application.origin === 'Aumento de cupo' ? 12 : application.termMonths)) || 12;
    const loanId = advanceEvent?.details?.loanId || application.loanId;
    const paused = db.simulationAutomation?.paused === true;
    const issue = application.autoAdvanceIssue;
    const statusText = advanceEvent ? 'Realizado' : (pending ? (issue ? 'Revisar motivo' : (paused ? 'Pausado' : 'Pendiente')) : 'Realizado');
    const card = document.createElement('article');
    card.className = 'reviewer-application-card';

    const heading = document.createElement('div');
    heading.className = 'reviewer-card-heading';
    const applicant = document.createElement('div');
    applicant.className = 'reviewer-applicant';
    const title = document.createElement('h3');
    title.textContent = name;
    const subtitle = document.createElement('p');
    const lastFour = String(application.accountNumber || account?.accountNumber || '').replace(/\s/g, '').slice(-4);
    const operation = (advanceEvent?.category === 'cupo' || application.origin === 'Aumento de cupo') ? 'Aumento de cupo' : 'Crédito';
    const reference = advanceEvent ? (loanId || application.id) : application.id;
    subtitle.textContent = `Cuenta •••• ${lastFour} · ${operation} · ${advanceEvent ? 'Avance' : 'Solicitud'} ${String(reference || '').slice(-7)}`;
    applicant.append(title, subtitle);
    const status = document.createElement('span');
    status.className = `credit-status ${pending ? (issue ? 'status-rejected' : 'status-pending') : 'status-approved'}`;
    status.textContent = statusText;
    heading.append(applicant, status);

    const details = document.createElement('div');
    details.className = 'reviewer-detail-grid';
    const values = advanceEvent
      ? [['Monto de este avance', money(amount)], ['Plazo aplicado', `${term} cuotas`], ['Crédito asociado', loanId ? String(loanId).slice(-7) : 'Registrado'], ['Fecha del avance', date && Number.isFinite(Date.parse(date)) ? shortDateTime(date) : 'Fecha no disponible']]
      : (pending
        ? [['Saldo pendiente en tarjeta', money(pendingAutomaticAdvanceAmount(application))], ['Avance acumulado', money(accumulated)], ['Plazo al avanzar', `${term} cuotas`], ['Próximo intento', date && Number.isFinite(Date.parse(date)) ? shortDateTime(date) : 'Esperando programación']]
        : [['Total avanzado', money(accumulated || amount)], ['Plazo aplicado', `${term} cuotas`], ['Crédito asociado', loanId ? String(loanId).slice(-7) : 'Registrado'], ['Fecha del último avance', date && Number.isFinite(Date.parse(date)) ? shortDateTime(date) : 'Fecha no disponible']]);
    values.forEach(([label, value]) => {
      const cell = document.createElement('div'); cell.className = 'reviewer-detail-cell';
      const caption = document.createElement('span'); caption.textContent = label;
      const content = document.createElement('strong'); content.textContent = value;
      cell.append(caption, content); details.append(cell);
    });
    card.append(heading, details);
    if (pending && (issue || paused)) {
      const note = document.createElement('p');
      note.className = 'reviewer-existing-note';
      note.textContent = issue
        ? `El sistema reintentará el avance. Motivo: ${issue}`
        : 'La automatización está pausada. Este avance se procesará al reanudarla.';
      card.append(note);
    }
    return card;
  }

  function renderReviewerAutomaticAdvances() {
    if (!reviewerSession) return;
    const pendingList = $('#reviewerAutomaticAdvancesList');
    const historyList = $('#reviewerAutomaticAdvancesHistory');
    if (!pendingList || !historyList) return;
    const selectedClientId = typeof getReviewerSelectedClientId === 'function' ? getReviewerSelectedClientId() : null;
    const applications = (Array.isArray(db.creditApplications) ? db.creditApplications : [])
      .filter((application) => selectedClientId === null || Number(application.accountId) === selectedClientId);
    const pending = applications.filter((application) => application.origin !== 'Aumento de cupo'
      && application.status === 'Aprobado' && pendingAutomaticAdvanceAmount(application) > 0 && !application.autoAdvancedAt)
      .sort((left, right) => Date.parse(left.autoAdvanceAt || left.autoAdvanceDeferredAt || left.disbursedAt || left.date || 0)
        - Date.parse(right.autoAdvanceAt || right.autoAdvanceDeferredAt || right.disbursedAt || right.date || 0));

    const advanceEvents = (Array.isArray(db.auditLog) ? db.auditLog : [])
      .filter((event) => event.action === 'Crédito activado por avance'
        && (selectedClientId === null || Number(event.accountId) === selectedClientId))
      .sort((left, right) => Date.parse(right.date || 0) - Date.parse(left.date || 0))
      .slice(0, 30);
    const applicationsWithAdvanceEvents = new Set(advanceEvents.map((event) => event.referenceId).filter(Boolean));
    const historyRows = advanceEvents.map((event) => {
      const application = applications.find((item) => item.id === event.referenceId) || {
        id: event.referenceId, accountId: event.accountId, applicantName: event.accountName,
        origin: event.category === 'cupo' ? 'Aumento de cupo' : 'Crédito',
        termMonths: event.details?.termMonths || 12, loanId: event.details?.loanId
      };
      return { application, event };
    });
    applications.filter((application) => Number(application.activatedAmount) > 0
      && typeof application.lastAdvancedAt === 'string'
      && !applicationsWithAdvanceEvents.has(application.id))
      .sort((left, right) => Date.parse(right.lastAdvancedAt) - Date.parse(left.lastAdvancedAt))
      .forEach((application) => historyRows.push({ application, event: null }));
    historyRows.sort((left, right) => Date.parse(right.event?.date || right.application.lastAdvancedAt || right.application.autoAdvancedAt || right.application.date || 0)
      - Date.parse(left.event?.date || left.application.lastAdvancedAt || left.application.autoAdvancedAt || left.application.date || 0));
    const recentHistory = historyRows.slice(0, 30);

    pendingList.replaceChildren(...pending.map((application) => reviewerAutomaticAdvanceCard(application, true)));
    historyList.replaceChildren(...recentHistory.map(({ application, event }) => reviewerAutomaticAdvanceCard(application, false, event)));
    $('#reviewerAutomaticAdvancesPending').textContent = String(pending.length);
    $('#reviewerAutomaticAdvancesAmount').textContent = money(roundMoney(pending.reduce((sum, application) => sum + pendingAutomaticAdvanceAmount(application), 0)));
    $('#reviewerAutomaticAdvancesCompleted').textContent = String(recentHistory.length);
    $('#reviewerAutomaticAdvancesEmpty').hidden = pending.length > 0;
    $('#reviewerAutomaticAdvancesHistoryEmpty').hidden = recentHistory.length > 0;
    pendingList.hidden = pending.length === 0;
    historyList.hidden = recentHistory.length === 0;
  }
