  function consolidateActiveLoans(database) {
    if (!database || !Array.isArray(database.loans)) return;
    for (let accountId = 1; accountId <= MAX_ACCOUNT_ID; accountId += 1) {
      const activeLoans = database.loans
        .filter((loan) => loan.accountId === accountId && loan.status !== 'Pagado' && Number(loan.outstandingPrincipal) > 0)
        .sort((a, b) => new Date(a.disbursedAt || 0) - new Date(b.disbursedAt || 0));
      if (activeLoans.length <= 1) continue;
      const primary = activeLoans[0];
      const activeIds = new Set(activeLoans.map((loan) => loan.id));
      const outstanding = roundMoney(activeLoans.reduce((sum, loan) => sum + Math.max(0, Number(loan.outstandingPrincipal) || 0), 0));
      const originalDisbursed = roundMoney(activeLoans.reduce((sum, loan) => {
        const original = Number.isFinite(loan.originalDisbursedTotal)
          ? loan.originalDisbursedTotal
          : (loan.source === 'Avance de capital recuperado' ? 0 : Number(loan.principalOriginal) || 0);
        return sum + Math.max(0, original);
      }, 0));
      const reusedCapital = roundMoney(activeLoans.reduce((sum, loan) => {
        const reused = Number.isFinite(loan.reborrowedCapitalTotal)
          ? loan.reborrowedCapitalTotal
          : (loan.source === 'Avance de capital recuperado' ? Number(loan.principalOriginal) || 0 : 0);
        return sum + Math.max(0, reused);
      }, 0));
      const allApplications = Array.from(new Set(activeLoans.flatMap((loan) => [
        ...(Array.isArray(loan.applicationIds) ? loan.applicationIds : []),
        ...(loan.applicationId ? [loan.applicationId] : [])
      ]).filter((id) => typeof id === 'string' && id)));
      const allPayments = activeLoans.flatMap((loan) => Array.isArray(loan.payments) ? loan.payments : [])
        .sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
      const priorInstallmentsPaid = activeLoans.reduce((sum, loan) => sum + Math.max(0, Number(loan.installmentsPaid) || 0), 0);
      primary.outstandingPrincipal = outstanding;
      primary.originalDisbursedTotal = originalDisbursed;
      primary.principalOriginal = originalDisbursed;
      primary.reborrowedCapitalTotal = reusedCapital;
      primary.applicationIds = allApplications;
      primary.applicationId = primary.applicationId || allApplications[0] || null;
      primary.payments = allPayments;
      primary.installmentsPaid = priorInstallmentsPaid;
      primary.monthlyRate = Number.isFinite(primary.monthlyRate) ? primary.monthlyRate : currentMonthlyInterestRate(database);
      primary.termMonths = priorInstallmentsPaid + 60;
      primary.monthlyPayment = calculateCreditEstimate(outstanding, 60, primary.monthlyRate).monthlyPayment;
      primary.nextDueDate = addMonthsToDate(localDateKey(), 1);
      primary.source = originalDisbursed > 0 ? 'Crédito unificado' : 'Avance de capital recuperado';
      primary.status = 'Activo';
      primary.closedAt = null;
      database.loans = database.loans.filter((loan) => !activeIds.has(loan.id) || loan.id === primary.id);
    }
  }

  function recordCardMovement(accountId, type, amount, description, direction = null, date = new Date().toISOString()) {
    const card = db.accounts[accountId].card;
    if (!Array.isArray(card.history)) card.history = [];
    const item = { id: createId(), type, amount: roundMoney(amount), description, direction, date };
    card.history.unshift(item);
    if (card.history.length > MAX_CARD_HISTORY_ITEMS) card.history.length = MAX_CARD_HISTORY_ITEMS;
    if (typeof recordAuditMovement === 'function') recordAuditMovement(accountId, item, 'Tarjeta');
    return item;
  }

  function readCurrentStorageRaw() {
    try { return localStorage.getItem(STORAGE_KEY); } catch (error) { return null; }
  }

  function captureDatabaseRevision() {
    return { revision: dbRevision, raw: readCurrentStorageRaw() };
  }

  function isDatabaseRevisionCurrent(token) {
    const currentRaw = readCurrentStorageRaw();
    return Boolean(token) && token.revision === dbRevision && token.raw === currentRaw && token.raw === lastPersistedRaw;
  }

  function refreshAfterDatabaseConflict() {
    db = loadDatabase();
    dbRevision += 1;
    if (typeof refreshRealtimeVisibleViews === 'function') {
      refreshRealtimeVisibleViews({ notify: false, reason: 'conflicto' });
    } else if (reviewerSession && reviewerView && !reviewerView.hidden) renderReviewerDashboard();
    else if (typeof treasurySession !== 'undefined' && treasurySession && treasuryView && !treasuryView.hidden && typeof renderTreasuryView === 'function') renderTreasuryView(true);
    else if (activeAccountId !== null && appView && !appView.hidden) renderApp();
  }

  function compactMovementHistory(history, maximumItems) {
    if (!Array.isArray(history) || history.length <= maximumItems) return { history: Array.isArray(history) ? history : [], compacted: false };
    const recent = history.slice(0, maximumItems);
    const older = history.slice(maximumItems);
    const grouped = new Map();
    older.forEach((movement) => {
      const type = String(movement?.type || 'movement');
      const direction = ['in', 'out'].includes(movement?.direction) ? movement.direction : null;
      const label = ['operation_fee', 'card_advance_fee'].includes(type) ? String(movement?.description || '') : '';
      const date = typeof movement?.date === 'string' && Number.isFinite(Date.parse(movement.date)) ? movement.date : new Date(0).toISOString();
      const parsedDate = new Date(date);
      const month = `${parsedDate.getFullYear()}-${String(parsedDate.getMonth() + 1).padStart(2, '0')}`;
      const key = `${type}|${direction || 'none'}|${label}|${month}`;
      const entry = grouped.get(key) || { type, direction, label, month, amount: 0, count: 0, date };
      const amount = Math.max(0, Math.round(Number(movement?.amount) || 0));
      entry.amount += amount;
      entry.count += Math.max(1, Math.round(Number(movement?.movementCount) || 1));
      if (String(date) > entry.date) entry.date = date;
      grouped.set(key, entry);
    });
    const summaries = Array.from(grouped.values()).map((entry) => ({
      id: createId(), type: entry.type, amount: entry.amount, direction: entry.direction, date: entry.date, movementCount: entry.count,
      description: `${entry.label ? entry.label + ' · ' : ''}Historial de ${entry.month} resumido: ${entry.count} movimiento(s) de tipo ${entry.type}.`
    }));
    return { history: [...recent, ...summaries], compacted: true };
  }

  function archivedFinancialSummaryFor(database) {
    if (!database.archivedFinancialSummary || typeof database.archivedFinancialSummary !== 'object') {
      database.archivedFinancialSummary = {};
    }
    const summary = database.archivedFinancialSummary;
    const accountTotals = Array.isArray(summary.originalDisbursementsByAccount) ? summary.originalDisbursementsByAccount : [];
    summary.originalDisbursementsByAccount = [null];
    for (let id = 1; id <= MAX_ACCOUNT_ID; id += 1) {
      const value = Number(accountTotals[id]);
      summary.originalDisbursementsByAccount[id] = Number.isSafeInteger(value) && value >= 0 ? value : 0;
    }
    for (const key of ['loanOriginalDisbursements', 'applicationActivatedDisbursements', 'interestEarned', 'principalRecovered', 'paymentsAmount', 'paymentCount']) {
      const value = Number(summary[key]);
      summary[key] = Number.isSafeInteger(value) && value >= 0 ? value : 0;
    }
    for (const key of ['principalRecoveredByAccount', 'interestEarnedByAccount', 'paymentsAmountByAccount', 'paymentCountByAccount']) {
      const prior = Array.isArray(summary[key]) ? summary[key] : [];
      summary[key] = [null];
      for (let id = 1; id <= MAX_ACCOUNT_ID; id += 1) {
        const value = Number(prior[id]);
        summary[key][id] = Number.isSafeInteger(value) && value >= 0 ? value : 0;
      }
    }
    const validMonthlyRows = (rows, fields) => (Array.isArray(rows) ? rows : []).filter((row) => row && /^\d{4}-\d{2}$/.test(row.month)
      && Number.isInteger(row.accountId) && row.accountId >= 1 && row.accountId <= MAX_ACCOUNT_ID
      && fields.every((field) => Number.isSafeInteger(row[field]) && row[field] >= 0));
    summary.monthlyPayments = validMonthlyRows(summary.monthlyPayments, ['amount', 'principal', 'interest', 'count']);
    summary.monthlyDisbursements = validMonthlyRows(summary.monthlyDisbursements, ['amount', 'count']);
    return summary;
  }

  function compactDatabaseForStorage(database, aggressive = false) {
    if (!database || typeof database !== 'object') return false;
    let compacted = false;
    const historyLimit = aggressive ? 100 : MAX_ACCOUNT_HISTORY_ITEMS;
    for (let id = 1; id <= MAX_ACCOUNT_ID; id += 1) {
      const current = database.accounts?.[id];
      if (!current) continue;
      const savings = compactMovementHistory(current.history, historyLimit);
      if (savings.compacted) { current.history = savings.history; compacted = true; }
      if (current.card && Array.isArray(current.card.history)) {
        const cardLimit = aggressive ? 100 : MAX_CARD_HISTORY_ITEMS;
        const cardHistory = compactMovementHistory(current.card.history, cardLimit);
        if (cardHistory.compacted) { current.card.history = cardHistory.history; compacted = true; }
      }
    }
    const treasury = database.withdrawalTreasury;
    if (treasury && Array.isArray(treasury.history)) {
      const treasuryHistory = compactMovementHistory(treasury.history, aggressive ? 300 : MAX_TREASURY_HISTORY_ITEMS);
      if (treasuryHistory.compacted) { treasury.history = treasuryHistory.history; compacted = true; }
    }
    if (Array.isArray(database.auditLog)) {
      const auditLimit = aggressive ? 500 : MAX_AUDIT_EVENTS;
      if (database.auditLog.length > auditLimit) { database.auditLog.length = auditLimit; compacted = true; }
    }

    const summary = archivedFinancialSummaryFor(database);
    const loans = Array.isArray(database.loans) ? database.loans : [];
    const closedLimit = aggressive ? 50 : MAX_CLOSED_LOANS;
    const closedLoans = loans.filter((loan) => loan && loan.status !== 'Activo' && Number(loan.outstandingPrincipal) <= 0)
      .sort((left, right) => Date.parse(right.closedAt || right.disbursedAt || 0) - Date.parse(left.closedAt || left.disbursedAt || 0));
    const archiveCandidates = closedLoans.slice(closedLimit).filter((loan) => {
      const applicationIds = new Set([...(Array.isArray(loan.applicationIds) ? loan.applicationIds : []), ...(loan.applicationId ? [loan.applicationId] : [])]);
      return !(database.creditApplications || []).some((application) => applicationIds.has(application.id) && Number(application.cardFundsRemaining) > 0);
    });
    const archivedApplicationIds = new Set();
    for (const loan of archiveCandidates) {
      const accountId = loan.accountId;
      const original = Math.max(0, Math.round(Number.isFinite(loan.originalDisbursedTotal)
        ? loan.originalDisbursedTotal
        : (loan.source === 'Avance de capital recuperado' ? 0 : Number(loan.principalOriginal) || 0)));
      const payments = Array.isArray(loan.payments) ? loan.payments : [];
      const paidInterest = payments.reduce((sum, payment) => sum + Math.max(0, Number(payment.interest) || 0), 0);
      const paidPrincipal = payments.reduce((sum, payment) => sum + Math.max(0, Number(payment.principal) || 0), 0);
      const applicationIds = new Set([...(Array.isArray(loan.applicationIds) ? loan.applicationIds : []), ...(loan.applicationId ? [loan.applicationId] : [])]);
      const linkedApplications = (database.creditApplications || []).filter((application) => applicationIds.has(application.id));
      const activated = linkedApplications.reduce((sum, application) => sum + Math.max(0, Number.isFinite(application.activatedAmount)
        ? application.activatedAmount : (['Desembolsado', 'Pagado'].includes(application.status) ? Number(application.amount) || 0 : 0)), 0);
      const paymentRows = payments.map((payment) => ({
        amount: Math.max(0, Math.round(Number(payment.amount) || 0)),
        principal: Math.max(0, Math.round(Number(payment.principal) || 0)),
        interest: Math.max(0, Math.round(Number(payment.interest) || 0)),
        date: payment.date || loan.closedAt || loan.disbursedAt
      }));
      const paidAmount = paymentRows.reduce((sum, payment) => sum + payment.amount, 0);
      const paymentCount = paymentRows.length;
      if (![original, paidInterest, paidPrincipal, activated, paidAmount, paymentCount].every(Number.isSafeInteger)) continue;
      summary.originalDisbursementsByAccount[accountId] = (summary.originalDisbursementsByAccount[accountId] || 0) + original;
      summary.loanOriginalDisbursements += original;
      summary.applicationActivatedDisbursements += activated;
      summary.interestEarned += paidInterest;
      summary.principalRecovered += paidPrincipal;
      summary.paymentsAmount += paidAmount;
      summary.paymentCount += paymentCount;
      summary.interestEarnedByAccount[accountId] += paidInterest;
      summary.principalRecoveredByAccount[accountId] += paidPrincipal;
      summary.paymentsAmountByAccount[accountId] += paidAmount;
      summary.paymentCountByAccount[accountId] += paymentCount;
      const paymentBuckets = new Map(summary.monthlyPayments.map((row) => [`${row.accountId}|${row.month}`, row]));
      paymentRows.forEach((payment) => {
        const paymentDate = new Date(payment.date);
        if (Number.isNaN(paymentDate.getTime())) return;
        const month = `${paymentDate.getFullYear()}-${String(paymentDate.getMonth() + 1).padStart(2, '0')}`;
        const key = `${accountId}|${month}`;
        const bucket = paymentBuckets.get(key) || { accountId, month, amount: 0, principal: 0, interest: 0, count: 0 };
        bucket.amount += payment.amount; bucket.principal += payment.principal; bucket.interest += payment.interest; bucket.count += 1;
        paymentBuckets.set(key, bucket);
      });
      summary.monthlyPayments = Array.from(paymentBuckets.values());
      const disbursementBuckets = new Map(summary.monthlyDisbursements.map((row) => [`${row.accountId}|${row.month}`, row]));
      linkedApplications.forEach((application) => {
        const disbursementDate = new Date(application.disbursedAt || application.date);
        if (Number.isNaN(disbursementDate.getTime())) return;
        const month = `${disbursementDate.getFullYear()}-${String(disbursementDate.getMonth() + 1).padStart(2, '0')}`;
        const key = `${accountId}|${month}`;
        const bucket = disbursementBuckets.get(key) || { accountId, month, amount: 0, count: 0 };
        bucket.amount += Math.max(0, Math.round(Number(application.amount) || 0)); bucket.count += 1;
        disbursementBuckets.set(key, bucket);
      });
      summary.monthlyDisbursements = Array.from(disbursementBuckets.values());
      linkedApplications.forEach((application) => archivedApplicationIds.add(application.id));
      compacted = true;
    }
    if (archiveCandidates.length) {
      const archivedLoanIds = new Set(archiveCandidates.map((loan) => loan.id));
      database.loans = loans.filter((loan) => !archivedLoanIds.has(loan.id));
      database.creditApplications = (database.creditApplications || []).filter((application) => !archivedApplicationIds.has(application.id));
    }

    if (Array.isArray(database.creditApplications)) {
      const pinned = new Set();
      (database.loans || []).forEach((loan) => {
        (Array.isArray(loan.applicationIds) ? loan.applicationIds : []).forEach((id) => pinned.add(id));
        if (loan.applicationId) pinned.add(loan.applicationId);
      });
      database.accounts?.slice(1).forEach((current) => {
        (current?.card?.pendingDisbursements || []).forEach((entry) => pinned.add(entry.applicationId));
      });
      database.creditApplications.forEach((application) => {
        if ((application.status || 'En revisión') === 'En revisión' || Number(application.cardFundsRemaining) > 0) pinned.add(application.id);
      });
      const terminal = database.creditApplications.filter((application) => !pinned.has(application.id));
      const applicationLimit = aggressive ? 100 : MAX_CREDIT_APPLICATIONS;
      if (terminal.length > applicationLimit) {
        const toRemove = new Set(terminal.slice(applicationLimit).filter((application) => {
          const activated = Number.isFinite(application.activatedAmount)
            ? Math.max(0, Number(application.activatedAmount))
            : (['Desembolsado', 'Pagado'].includes(application.status) ? Math.max(0, Number(application.amount) || 0) : 0);
          return activated === 0;
        }).map((application) => application.id));
        database.creditApplications.filter((application) => toRemove.has(application.id)).forEach((application) => {
          const activated = Math.max(0, Math.round(Number(application.activatedAmount) || 0));
          if (Number.isSafeInteger(summary.applicationActivatedDisbursements + activated)) summary.applicationActivatedDisbursements += activated;
        });
        if (toRemove.size) {
          database.creditApplications = database.creditApplications.filter((application) => !toRemove.has(application.id));
          (database.loans || []).forEach((loan) => {
            loan.applicationIds = (Array.isArray(loan.applicationIds) ? loan.applicationIds : []).filter((id) => !toRemove.has(id));
            if (toRemove.has(loan.applicationId)) loan.applicationId = loan.applicationIds[0] || null;
          });
          compacted = true;
        }
      }
    }
    if (Array.isArray(database.limitIncreaseRequests)) {
      const requestLimit = aggressive ? 100 : MAX_LIMIT_INCREASE_REQUESTS;
      const pending = database.limitIncreaseRequests.filter((request) => (request.status || 'En revisión') === 'En revisión');
      const terminal = database.limitIncreaseRequests.filter((request) => (request.status || 'En revisión') !== 'En revisión').slice(0, requestLimit);
      if (pending.length + terminal.length < database.limitIncreaseRequests.length) {
        database.limitIncreaseRequests = [...pending, ...terminal];
        compacted = true;
      }
    }
    return compacted;
  }

  let storageCompactionNoticeShown = false;
  function saveDatabase(options = {}) {
    let compactedForSave = false;
    try {
      const currentRaw = localStorage.getItem(STORAGE_KEY);
      if (databaseLoadIssue) {
        showToast('Los datos guardados parecen dañados o incompletos. Para evitar sobrescribirlos, importa una copia válida o utiliza Borrar todos los datos tras confirmar.', 'error');
        return false;
      }
      if (currentRaw !== lastPersistedRaw) {
        if (typeof refreshAfterDatabaseConflict === 'function') refreshAfterDatabaseConflict();
        else { db = loadDatabase(); dbRevision += 1; }
        showToast('Otra pestaña modificó los datos. Esta operación no se guardó para evitar sobrescribir cambios; revisa los saldos actualizados.', 'error');
        return false;
      }
      const automationCatchup = options.skipAutomationCatchup
        ? null
        : (typeof processSimulationAutomationEvents === 'function' ? processSimulationAutomationEvents(Date.now()) : null);
      if (!options.skipAutomationCatchup && automationCatchup?.caughtUp !== false) accrueWithdrawalTreasury();
      compactedForSave = compactDatabaseForStorage(db);
      let serialized = JSON.stringify(db);
      try {
        localStorage.setItem(STORAGE_KEY, serialized);
      } catch (storageError) {
        compactDatabaseForStorage(db, true);
        compactedForSave = true;
        serialized = JSON.stringify(db);
        localStorage.setItem(STORAGE_KEY, serialized);
      }
      lastPersistedRaw = serialized;
      dbRevision += 1;
      if (automationCatchup?.caughtUp === false && typeof scheduleSimulationAutomationCatchUp === 'function') scheduleSimulationAutomationCatchUp();
      if (typeof simulationAutomationInitialSaveDone !== 'undefined') simulationAutomationInitialSaveDone = true;
      if (typeof simulationAutomationLastSavedAt !== 'undefined') simulationAutomationLastSavedAt = Date.now();
      // Notifica a otras pestañas después de persistir el estado. El módulo realtime
      // se carga al final; el guard mantiene compatible el guardado de arranque.
      if (typeof broadcastDatabaseSaved === 'function') broadcastDatabaseSaved();
      if (compactedForSave && !storageCompactionNoticeShown) {
        storageCompactionNoticeShown = true;
        showToast('Se resumió el historial antiguo para liberar espacio; los saldos, créditos activos y comisiones se conservaron.', 'info');
      }
      return true;
    } catch (error) {
      showToast('No se pudo guardar en este navegador. Comprueba el almacenamiento disponible o exporta una copia de seguridad.', 'error');
      return false;
    }
  }

  function resetDailyWithdrawalIfNeeded(account) {
    const today = localDateKey();
    if (account.withdrawalDate !== today) {
      account.withdrawnToday = 0;
      account.withdrawalDate = today;
    }
  }
