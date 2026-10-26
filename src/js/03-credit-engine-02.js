  function estimateRemainingInstallments(loan) {
    let balance = roundMoney(loan.outstandingPrincipal);
    let count = 0;
    const monthlyPayment = roundMoney(loan.monthlyPayment);
    while (balance > 0 && count < 1200) {
      const interest = Math.round(balance * loan.monthlyRate);
      const payment = Math.min(monthlyPayment, balance + interest);
      const principal = Math.min(balance, Math.max(0, payment - interest));
      if (principal <= 0) break;
      balance = Math.max(0, balance - principal);
      count += 1;
    }
    return count;
  }

  function findLoanForApplication(applicationId) {
    return (db.loans || []).find((loan) => loan.applicationId === applicationId || (Array.isArray(loan.applicationIds) && loan.applicationIds.includes(applicationId)));
  }

  function updateLinkedApplicationsStatus(loan, status) {
    const linked = new Set([...(Array.isArray(loan.applicationIds) ? loan.applicationIds : []), ...(loan.applicationId ? [loan.applicationId] : [])]);
    (db.creditApplications || []).forEach((application) => {
      if (!linked.has(application.id)) return;
      application.status = Number(application.cardFundsRemaining) > 0 ? 'Aprobado' : status;
    });
  }

  function recalculateUnifiedLoanSchedule(loan, remainingMonths = 60, scheduleAt = new Date().toISOString()) {
    const months = Math.max(1, Math.round(Number(remainingMonths) || 60));
    loan.monthlyRate = Number.isFinite(loan.monthlyRate) ? loan.monthlyRate : currentMonthlyInterestRate();
    loan.monthlyPayment = roundMoney(calculateCreditEstimate(loan.outstandingPrincipal, months, loan.monthlyRate).monthlyPayment);
    loan.termMonths = Math.max(0, Number(loan.installmentsPaid) || 0) + months;
    loan.automaticPaymentIntervalSeconds = automaticPaymentIntervalForTerm(loan.termMonths, db, loan.paymentScheduleType);
    loan.nextAutomaticPaymentAt = new Date(Date.parse(scheduleAt) + loan.automaticPaymentIntervalSeconds * 1000).toISOString();
    if (!loan.nextDueDate) loan.nextDueDate = addMonthsToDate(localDateKey(), 1);
    const linkedApplicationIds = new Set([...(Array.isArray(loan.applicationIds) ? loan.applicationIds : []), ...(loan.applicationId ? [loan.applicationId] : [])]);
    const estimate = calculateCreditEstimate(loan.outstandingPrincipal, months, loan.monthlyRate);
    (db.creditApplications || []).forEach((application) => {
      if (!linkedApplicationIds.has(application.id) || ['En revisión', 'Rechazado'].includes(application.status)) return;
      application.monthlyPayment = loan.monthlyPayment;
      application.unifiedDebtBalance = loan.outstandingPrincipal;
      application.totalPayable = estimate.totalPayable;
      application.totalInterest = estimate.totalInterest;
      application.unifiedTermMonths = months;
    });
  }

  function addRecoveredCapitalToUnifiedDebt(accountId, principal, termMonths = 60) {
    const amount = roundMoney(principal);
    if (amount <= 0) return null;
    const chosenTerm = VALID_CARD_ADVANCE_TERMS.includes(Number(termMonths)) ? Number(termMonths) : 12;
    let loan = (db.loans || []).find((item) => item.accountId === accountId && item.status === 'Activo' && Number(item.outstandingPrincipal) > 0);
    if (!loan) {
      loan = createLoanFromCardAdvance(accountId, amount, chosenTerm);
      if (!loan) return null;
      db.loans.unshift(loan);
      return loan;
    }
    loan.outstandingPrincipal = roundMoney(loan.outstandingPrincipal + amount);
    loan.reborrowedCapitalTotal = roundMoney((Number(loan.reborrowedCapitalTotal) || 0) + amount);
    loan.originalDisbursedTotal = Math.max(0, roundMoney(Number.isFinite(loan.originalDisbursedTotal) ? loan.originalDisbursedTotal : (loan.source === 'Avance de capital recuperado' ? 0 : Number(loan.principalOriginal) || 0)));
    loan.principalOriginal = loan.originalDisbursedTotal;
    loan.applicationIds = Array.from(new Set([...(Array.isArray(loan.applicationIds) ? loan.applicationIds : []), ...(loan.applicationId ? [loan.applicationId] : [])]));
    loan.source = loan.originalDisbursedTotal > 0 ? 'Crédito unificado' : 'Avance de capital recuperado';
    loan.paymentScheduleType = 'advance';
    recalculateUnifiedLoanSchedule(loan, chosenTerm);
    return loan;
  }
