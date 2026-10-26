  function renderReviewerLimitIncreaseRequests() {
    if (!reviewerSession || !reviewerLimitRequestsList) return;
    const selectedClientId = getReviewerSelectedClientId();
    const requests = (Array.isArray(db.limitIncreaseRequests) ? db.limitIncreaseRequests : [])
      .filter((request) => selectedClientId === null || Number(request.accountId) === selectedClientId)
      .slice().sort((a, b) => new Date(b.date) - new Date(a.date));
    reviewerLimitRequestsList.replaceChildren();
    const empty = $('#reviewerLimitRequestsEmpty');
    if (empty) empty.hidden = requests.length > 0;
    reviewerLimitRequestsList.hidden = requests.length === 0;
    requests.forEach((request) => {
      const card = document.createElement('article');
      card.className = 'reviewer-application-card';
      const heading = document.createElement('div');
      heading.className = 'reviewer-card-heading';
      const applicant = document.createElement('div');
      applicant.className = 'reviewer-applicant';
      const name = document.createElement('h3');
      name.textContent = request.applicantName || db.accounts[request.accountId]?.name || 'Cliente';
      const accountLine = document.createElement('p');
      accountLine.textContent = `Cuenta •••• ${(request.accountNumber || db.accounts[request.accountId]?.accountNumber || '').replace(/\s/g, '').slice(-4)} · Solicitud ${String(request.id).slice(-7)}`;
      applicant.append(name, accountLine);
      const status = document.createElement('span');
      status.className = `credit-status ${statusClass(request.status || 'En revisión')}`;
      status.textContent = request.status || 'En revisión';
      heading.append(applicant, status);
      const details = document.createElement('div');
      details.className = 'reviewer-detail-grid';
      const currentCardLimit = typeof cardCreditLimitForAccount === 'function' ? cardCreditLimitForAccount(request.accountId) : Number(db.accounts[request.accountId]?.card?.limit) || 0;
      [[ 'Cupo antes de la solicitud', money(request.previousLimit) ], [ 'Cupo actual de la tarjeta', money(currentCardLimit) ], [ 'Aumento solicitado', money(Number(request.increaseAmount) || Math.max(0, request.requestedLimit - request.previousLimit)) ], [ 'Nuevo cupo solicitado', money(request.requestedLimit) ], [ 'Desembolso previsto a tarjeta', money(Math.max(0, request.requestedLimit - request.previousLimit)) ], [ 'Plazo del crédito al avanzar', `12 cuotas al ${formatMonthlyInterestRate()} mensual` ], [ 'Fecha', shortDateTime(request.date) ], ...(Number(request.disbursedAmount) > 0 ? [['Desembolso cargado a tarjeta', money(request.disbursedAmount)], ['Fondos aún en tarjeta', money(request.cardFundsRemaining || 0)]] : [])].forEach(([label, value]) => {
        const cell = document.createElement('div'); cell.className = 'reviewer-detail-cell';
        const caption = document.createElement('span'); caption.textContent = label;
        const content = document.createElement('strong'); content.textContent = value;
        cell.append(caption, content); details.append(cell);
      });
      card.append(heading);
      appendReviewerLiveClientBalanceSnapshot(card, request.accountId);
      card.append(details);
      if (request.reviewerNote) { const note = document.createElement('p'); note.className='reviewer-existing-note'; note.textContent=`Nota del analista: ${request.reviewerNote}`; card.append(note); }
      if ((request.status || 'En revisión') === 'En revisión') {
        const actions = document.createElement('div'); actions.className = 'reviewer-card-actions';
        const approve = document.createElement('button'); approve.type='button'; approve.className='button button-primary reviewer-approve-button'; approve.dataset.limitRequestId=request.id; approve.dataset.limitRequestDecision='Aprobado'; approve.textContent='Aprobar aumento';
        const reject = document.createElement('button'); reject.type='button'; reject.className='button button-secondary reviewer-reject-button'; reject.dataset.limitRequestId=request.id; reject.dataset.limitRequestDecision='Rechazado'; reject.textContent='Rechazar solicitud';
        actions.append(approve, reject); card.append(actions);
      }
      reviewerLimitRequestsList.append(card);
    });
  }
