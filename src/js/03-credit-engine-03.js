  function addOriginalDisbursementToUnifiedDebt(application) {
    const amount = roundMoney(application.amount);
    let loan = (db.loans || []).find((item) => item.accountId === application.accountId && item.status === 'Activo' && Number(item.outstandingPrincipal) > 0);
    if (!loan) {
      loan = createLoanFromApplication({ ...application, paymentScheduleType: 'advance' });
      db.loans.unshift(loan);
      return loan;
    }
    const priorRemainingMonths = Math.max(1, estimateRemainingInstallments(loan));
    loan.outstandingPrincipal = roundMoney(loan.outstandingPrincipal + amount);
    loan.originalDisbursedTotal = roundMoney((Number.isFinite(loan.originalDisbursedTotal)
      ? loan.originalDisbursedTotal
      : (loan.source === 'Avance de capital recuperado' ? 0 : Number(loan.principalOriginal) || 0)) + amount);
    loan.principalOriginal = loan.originalDisbursedTotal;
    loan.reborrowedCapitalTotal = Math.max(0, roundMoney(Number(loan.reborrowedCapitalTotal) || 0));
    loan.applicationIds = Array.from(new Set([...(Array.isArray(loan.applicationIds) ? loan.applicationIds : []), ...(loan.applicationId ? [loan.applicationId] : []), application.id].filter(Boolean)));
    loan.applicationId = loan.applicationId || application.id;
    loan.source = 'Crédito unificado';
    loan.paymentScheduleType = 'advance';
    const selectedAdvanceTerm = Number(application.termMonths);
    const requestedTerm = application.origin === 'Aumento de cupo'
      ? 12
      : (VALID_CARD_ADVANCE_TERMS.includes(selectedAdvanceTerm) ? selectedAdvanceTerm : Math.max(priorRemainingMonths, 12));
    recalculateUnifiedLoanSchedule(loan, requestedTerm, application.lastAdvancedAt || new Date().toISOString());
    return loan;
  }

  function pendingCardDisbursementTotalForAccount(accountId) {
    const entries = db.accounts?.[accountId]?.card?.pendingDisbursements;
    return roundMoney((Array.isArray(entries) ? entries : []).reduce((sum, item) => sum + Math.max(0, Number(item.remainingAmount) || 0), 0));
  }

  function pendingCardDisbursementTotalAcrossSystem() {
    return roundMoney((db.accounts || []).slice(1).reduce((sum, accountRecord) => {
      return sum + (Array.isArray(accountRecord?.card?.pendingDisbursements)
        ? accountRecord.card.pendingDisbursements.reduce((accountSum, item) => accountSum + Math.max(0, Number(item.remainingAmount) || 0), 0)
        : 0);
    }, 0));
  }

  function analystCapitalCommitted() {
    return roundMoney(outstandingLoanPrincipalAcrossSystem() + pendingCardDisbursementTotalAcrossSystem());
  }

  function queueCardDisbursement(accountId, application, amount) {
    const value = roundMoney(amount);
    const card = db.accounts?.[accountId]?.card;
    if (!card || !application?.id || value <= 0) return false;
    if (!Array.isArray(card.pendingDisbursements)) card.pendingDisbursements = [];
    const entry = card.pendingDisbursements.find((item) => item.applicationId === application.id);
    if (entry) entry.remainingAmount = roundMoney(entry.remainingAmount + value);
    else card.pendingDisbursements.push({
      applicationId: application.id,
      remainingAmount: value,
      origin: application.origin === 'Aumento de cupo' ? 'Aumento de cupo' : 'Crédito',
      termMonths: application.origin === 'Aumento de cupo' ? 12 : (Number(application.termMonths) || 60),
      createdAt: application.disbursedAt || new Date().toISOString()
    });
    application.activatedAmount = Math.max(0, roundMoney(Number(application.activatedAmount) || 0));
    application.cardFundsRemaining = roundMoney((Number(application.cardFundsRemaining) || 0) + value);
    return true;
  }

  function cardAdvanceTermForAmount(accountId, amount, selectedTermMonths) {
    let remainingToActivate = Math.min(roundMoney(amount), pendingCardDisbursementTotalForAccount(accountId));
    const entries = db.accounts?.[accountId]?.card?.pendingDisbursements;
    for (const entry of (Array.isArray(entries) ? entries : [])) {
      if (remainingToActivate <= 0) break;
      const entryAmount = Math.max(0, roundMoney(Number(entry.remainingAmount) || 0));
      const allocation = Math.min(entryAmount, remainingToActivate);
      if (allocation <= 0) continue;
      const application = (db.creditApplications || []).find((item) => item.id === entry.applicationId && item.accountId === accountId);
      if (application?.origin === 'Aumento de cupo') return 12;
      remainingToActivate -= allocation;
    }
    const selected = Number(selectedTermMonths);
    return VALID_CARD_ADVANCE_TERMS.includes(selected) ? selected : 12;
  }

  function activatePendingCardDisbursements(accountId, amount, selectedTermMonths, advancedAt = new Date().toISOString()) {
    const card = db.accounts?.[accountId]?.card;
    const requestedAmount = roundMoney(amount);
    if (!card || requestedAmount <= 0) return { ok: false, activatedAmount: 0, activations: [] };
    const entries = Array.isArray(card.pendingDisbursements) ? card.pendingDisbursements : [];
    let remainingToActivate = Math.min(requestedAmount, pendingCardDisbursementTotalForAccount(accountId));
    if (remainingToActivate <= 0) return { ok: true, activatedAmount: 0, activations: [] };

    const allocations = [];
    for (const entry of entries) {
      if (remainingToActivate <= 0) break;
      const entryAmount = Math.max(0, roundMoney(Number(entry.remainingAmount) || 0));
      if (!entryAmount) continue;
      const sourceApplication = (db.creditApplications || []).find((item) => item.id === entry.applicationId && item.accountId === accountId);
      if (!sourceApplication || entryAmount > Math.max(0, Number(sourceApplication.cardFundsRemaining) || 0)) {
        return { ok: false, activatedAmount: 0, activations: [], error: 'No se pudo validar el origen de los fondos pendientes de la tarjeta.' };
      }
      const allocation = Math.min(entryAmount, remainingToActivate);
      allocations.push({ entry, sourceApplication, amount: allocation });
      remainingToActivate -= allocation;
    }

    if (remainingToActivate > 0) return { ok: false, activatedAmount: 0, activations: [], error: 'Los fondos pendientes de la tarjeta no coinciden con el monto del avance.' };

    allocations.sort((left, right) => Number(left.sourceApplication.origin === 'Aumento de cupo') - Number(right.sourceApplication.origin === 'Aumento de cupo'));
    const activations = [];
    for (const allocation of allocations) {
      const { entry, sourceApplication, amount: activatedAmount } = allocation;
      const termMonths = sourceApplication.origin === 'Aumento de cupo'
        ? 12
        : (VALID_CARD_ADVANCE_TERMS.includes(Number(selectedTermMonths)) ? Number(selectedTermMonths) : 12);
      const loan = addOriginalDisbursementToUnifiedDebt({ ...sourceApplication, lastAdvancedAt: advancedAt, amount: activatedAmount, termMonths });
      entry.remainingAmount = roundMoney(Math.max(0, Number(entry.remainingAmount) - activatedAmount));
      sourceApplication.activatedAmount = roundMoney((Number(sourceApplication.activatedAmount) || 0) + activatedAmount);
      sourceApplication.cardFundsRemaining = roundMoney(Math.max(0, (Number(sourceApplication.cardFundsRemaining) || 0) - activatedAmount));
      sourceApplication.loanId = loan.id;
      sourceApplication.lastAdvancedAt = advancedAt;
      sourceApplication.status = sourceApplication.cardFundsRemaining > 0 ? 'Aprobado' : 'Desembolsado';
      if (sourceApplication.origin === 'Aumento de cupo' && sourceApplication.limitIncreaseRequestId) {
        const request = (db.limitIncreaseRequests || []).find((item) => item.id === sourceApplication.limitIncreaseRequestId);
        if (request) {
          request.loanId = loan.id;
          request.creditApplicationId = sourceApplication.id;
          request.activatedAmount = roundMoney((Number(request.activatedAmount) || 0) + activatedAmount);
          request.cardFundsRemaining = sourceApplication.cardFundsRemaining;
        }
      }
      if (typeof recordAuditEvent === 'function') {
        recordAuditEvent('Crédito activado por avance', {
          category: sourceApplication.origin === 'Aumento de cupo' ? 'cupo' : 'creditos',
          accountId,
          amount: activatedAmount,
          source: 'Cliente',
          referenceId: sourceApplication.id,
          description: `Fondos trasladados de la tarjeta a ahorros; crédito ${String(loan.id).slice(-7)}`,
          details: { loanId: loan.id, termMonths, cardFundsRemaining: sourceApplication.cardFundsRemaining }, date: advancedAt
        });
      }
      activations.push({ applicationId: sourceApplication.id, loanId: loan.id, amount: activatedAmount, termMonths, origin: sourceApplication.origin || 'Crédito' });
    }

    card.pendingDisbursements = entries.filter((item) => Number(item.remainingAmount) > 0);
    return {
      ok: true,
      activatedAmount: roundMoney(activations.reduce((sum, item) => sum + item.amount, 0)),
      activations
    };
  }

  function outstandingLoanPrincipalForAccount(accountId) {
    return roundMoney((db.loans || []).reduce((sum, loan) => {
      if (loan.accountId !== accountId) return sum;
      return sum + Math.max(0, Number(loan.outstandingPrincipal) || 0);
    }, 0));
  }

  function outstandingLoanPrincipalAcrossSystem() {
    return roundMoney((db.loans || []).reduce((sum, loan) => sum + Math.max(0, Number(loan.outstandingPrincipal) || 0), 0));
  }

  function outstandingCreditExposureForAccount(accountId) {
    const legacyCardDebt = Math.max(0, Number(db.accounts[accountId]?.card?.debt) || 0);
    return roundMoney(outstandingLoanPrincipalForAccount(accountId) + legacyCardDebt + pendingCardDisbursementTotalForAccount(accountId));
  }

  function cardCreditLimitForAccount(accountId) {
    const value = Number(db.accounts[accountId]?.card?.limit);
    return Number.isFinite(value) ? Math.min(MAX_CARD_LIMIT, Math.max(MAX_CARD_FUNDS, roundMoney(value))) : MAX_CARD_FUNDS;
  }

  function availablePersonalCreditForAccount(accountId) {
    return Math.max(0, roundMoney(cardCreditLimitForAccount(accountId) - outstandingCreditExposureForAccount(accountId)));
  }

  // Only interest actually received through completed payments counts as earnings.
  function totalInterestEarned() {
    const archivedInterest = Math.max(0, Number(db.archivedFinancialSummary?.interestEarned) || 0);
    return roundMoney(archivedInterest + (db.loans || []).reduce((loanSum, loan) => {
      const paidInterest = (Array.isArray(loan.payments) ? loan.payments : []).reduce((sum, payment) => {
        return sum + Math.max(0, Number(payment.interest) || 0);
      }, 0);
      return loanSum + paidInterest;
    }, 0));
  }

  function totalAdvanceFeesEarned() {
    return Math.max(0, roundMoney(Number(db.advanceFeesCollected) || 0));
  }

  function totalOperationFeesEarned() {
    return Math.max(0, roundMoney(Number(db.operationFeesCollected) || 0));
  }
