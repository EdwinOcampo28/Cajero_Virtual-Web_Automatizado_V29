  function automaticPaymentIntervalForLoan(loan) {
    const savedInterval = Number(loan?.automaticPaymentIntervalSeconds);
    if (Number.isSafeInteger(savedInterval) && savedInterval >= 1 && savedInterval <= 31536000) return savedInterval;
    return automaticPaymentIntervalForTerm(loan?.termMonths, db, loan?.paymentScheduleType);
  }

  function applyInstallmentPayment(loan, current, installment, paymentDate = new Date().toISOString()) {
    if (!loan || !current || loan.status !== 'Activo' || current.balance < installment.paymentAmount) return false;
    current.balance = roundMoney(current.balance - installment.paymentAmount);
    loan.outstandingPrincipal = Math.max(0, roundMoney(loan.outstandingPrincipal - installment.principal));
    restoreCardAdvanceBalance(current, installment.principal);
    loan.installmentsPaid = Math.max(0, Number(loan.installmentsPaid) || 0) + 1;
    loan.payments = Array.isArray(loan.payments) ? loan.payments : [];
    loan.payments.push({ id: createId(), type: 'Cuota', installmentNumber: installment.installmentNumber, amount: installment.paymentAmount, interest: installment.interest, principal: installment.principal, date: paymentDate, dueDate: installment.dueDate, remainingPrincipal: loan.outstandingPrincipal });
    recordMovement(loan.accountId, 'loan_payment', installment.paymentAmount, `Pago cuota ${installment.installmentNumber} de crédito ${String(loan.id).slice(-7)}`, 'out', paymentDate);
    if (loan.outstandingPrincipal <= 0) {
      loan.outstandingPrincipal = 0;
      loan.status = 'Pagado';
      loan.closedAt = paymentDate;
      loan.nextAutomaticPaymentAt = null;
      updateLinkedApplicationsStatus(loan, 'Pagado');
    } else {
      loan.nextDueDate = addMonthsToDate(loan.nextDueDate, 1);
      loan.automaticPaymentIntervalSeconds = automaticPaymentIntervalForLoan(loan);
      loan.nextAutomaticPaymentAt = new Date(Date.parse(paymentDate) + loan.automaticPaymentIntervalSeconds * 1000).toISOString();
    }
    return true;
  }

  async function processInstallmentPayment(loanId) {
    if (typeof catchUpAutomaticEventsBeforeOperation === 'function' && !catchUpAutomaticEventsBeforeOperation()) return;
    const loan = (db.loans || []).find((item) => item.id === loanId && item.accountId === activeAccountId);
    const current = account();
    if (!loan || !current || loan.status !== 'Activo') return;
    const installment = nextInstallmentFor(loan);
    if (installment.paymentAmount <= 0) return showToast('Este crédito ya no tiene saldo pendiente.', 'error');
    if (current.balance < installment.paymentAmount) {
      return showToast(`Saldo insuficiente. Necesitas ${money(installment.paymentAmount)} y tienes ${money(current.balance)}.`, 'error');
    }
    const transactionRevision = captureDatabaseRevision();
    const confirmed = await showAppDialog({
      type: 'confirm',
      title: `Pagar cuota ${installment.installmentNumber}`,
      message: `Importe de la cuota: ${money(installment.paymentAmount)}\nCapital: ${money(installment.principal)}\nInterés: ${money(installment.interest)}\n\nEl dinero se descontará de tu cuenta de ahorros.`,
      eyebrow: 'PAGO DE CRÉDITO',
      icon: '$',
      confirmText: 'Pagar cuota'
    });
    if (!confirmed) return;
    if (!isDatabaseRevisionCurrent(transactionRevision)) { abortStaleFinancialOperation(); return; }
    const paymentDate = new Date().toISOString();
    if (!applyInstallmentPayment(loan, current, installment, paymentDate)) return;
    if (!saveDatabase()) { renderApp(); return; }
    renderApp();
    renderLoans();
    renderCreditApplications();
    showToast(`Cuota ${installment.installmentNumber} pagada: ${money(installment.paymentAmount)}.`);
  }