  function freshSimulationSettings() {
    return {
      monthlyInterestRate: ILLUSTRATIVE_MONTHLY_RATE,
      analystCapital: ANALYST_TOTAL_CAPITAL,
      limitIncreaseAmount: DEFAULT_LIMIT_INCREASE_AMOUNT,
      treasuryTimerRate: TREASURY_TIMER_RATE,
      treasuryTimerIncomeCap: TREASURY_TIMER_INCOME_CAP,
      creditRequestIntervalSeconds: SIMULATION_HOUR_MS / 1000,
      automaticCreditApprovalDelaySeconds: SIMULATION_APPROVAL_DELAY_MS / 1000,
      automaticAdvanceDelaySeconds: 30,
      automaticAnalystCapitalReserve: 500000000,
      automationSafetyPresetVersion: 1,
      automaticLimitIncreaseApprovalEnabled: true,
      automaticLimitIncreaseApprovalDelaySeconds: SIMULATION_APPROVAL_DELAY_MS / 1000,
      automaticTransferIntervalSeconds: SIMULATION_HOUR_MS / 1000,
      automaticWithdrawalIntervalSeconds: SIMULATION_HOUR_MS / 1000,
      limitIncreaseRequestIntervalSeconds: 24 * SIMULATION_HOUR_MS / 1000,
      treasuryDistributionIntervalSeconds: SIMULATION_HOUR_MS / 1000,
      paymentInterval6Seconds: AUTOMATIC_PAYMENT_INTERVAL_MS[6] / 1000,
      paymentInterval12Seconds: AUTOMATIC_PAYMENT_INTERVAL_MS[12] / 1000,
      advancePaymentInterval6Seconds: AUTOMATIC_PAYMENT_INTERVAL_MS[6] / 1000,
      advancePaymentInterval12Seconds: AUTOMATIC_PAYMENT_INTERVAL_MS[12] / 1000,
      automaticCreditMinimumAmount: MIN_CREDIT_AMOUNT,
      automaticCreditMaximumAmount: MAX_CREDIT_AMOUNT,
      automaticAdvanceMinimumAmount: MIN_CREDIT_AMOUNT,
      automaticAdvanceMaximumAmount: MAX_CREDIT_AMOUNT,
      automaticAdvanceMode: 'credit_amount',
      automaticCreditTermMonths: 0
    };
  }

  function freshSimulationAutomation(now = Date.now(), settings = freshSimulationSettings()) {
    const nextAt = (seconds) => new Date(now + seconds * 1000).toISOString();
    return {
      nextCreditRequestAt: nextAt(settings.creditRequestIntervalSeconds),
      nextLimitIncreaseRequestAt: nextAt(settings.limitIncreaseRequestIntervalSeconds),
      nextTreasuryDistributionAt: nextAt(settings.treasuryDistributionIntervalSeconds),
      nextAutomaticTransferAt: nextAt(settings.automaticTransferIntervalSeconds),
      nextAutomaticWithdrawalAt: nextAt(settings.automaticWithdrawalIntervalSeconds),
      paused: false, pausedAt: null, automationSafetyPresetVersion: 1
    };
  }

  function normalizeSimulationAutomation(database, now = Date.now()) {
    if (!database || typeof database !== 'object') return null;
    const saved = database.simulationAutomation;
    if (saved !== undefined && (!saved || typeof saved !== 'object' || Array.isArray(saved))) return null;
    const applySafetyPreset = saved?.automationSafetyPresetVersion !== 1;
    const automation = { ...freshSimulationAutomation(now), ...(saved || {}) };
    if (applySafetyPreset) {
      const settings = simulationSettingsFor(database);
      automation.nextCreditRequestAt = new Date(now + settings.creditRequestIntervalSeconds * 1000).toISOString();
      automation.nextLimitIncreaseRequestAt = new Date(now + settings.limitIncreaseRequestIntervalSeconds * 1000).toISOString();
      automation.nextTreasuryDistributionAt = new Date(now + settings.treasuryDistributionIntervalSeconds * 1000).toISOString();
      automation.nextAutomaticTransferAt = new Date(now + settings.automaticTransferIntervalSeconds * 1000).toISOString();
      automation.nextAutomaticWithdrawalAt = new Date(now + settings.automaticWithdrawalIntervalSeconds * 1000).toISOString();
      automation.paused = false;
      automation.pausedAt = null;
      automation.automationSafetyPresetVersion = 1;
    }
    if (typeof automation.paused !== 'boolean') return null;
    if (automation.pausedAt !== null && (typeof automation.pausedAt !== 'string' || !Number.isFinite(Date.parse(automation.pausedAt)))) return null;
    for (const key of ['nextCreditRequestAt', 'nextLimitIncreaseRequestAt', 'nextTreasuryDistributionAt', 'nextAutomaticTransferAt', 'nextAutomaticWithdrawalAt']) {
      if (typeof automation[key] !== 'string' || !Number.isFinite(Date.parse(automation[key]))) return null;
    }
    automation.automationSafetyPresetVersion = 1;
    database.simulationAutomation = automation;
    if (!Array.isArray(database.loans)) return automation;
    for (const loan of database.loans) {
      if (!loan) continue;
      if (!['advance', 'credit'].includes(loan.paymentScheduleType)) loan.paymentScheduleType = 'advance';
      if (loan.status !== 'Activo' || Number(loan.outstandingPrincipal) <= 0) continue;
      const interval = automaticPaymentIntervalForTerm(loan.termMonths, database, loan.paymentScheduleType);
      const legacyMinutes = Number(loan.automaticPaymentIntervalMinutes);
      if (applySafetyPreset || !Number.isSafeInteger(loan.automaticPaymentIntervalSeconds) || loan.automaticPaymentIntervalSeconds < 1 || loan.automaticPaymentIntervalSeconds > 31536000) {
        loan.automaticPaymentIntervalSeconds = interval;
      }
      delete loan.automaticPaymentIntervalMinutes;
      if (applySafetyPreset || typeof loan.nextAutomaticPaymentAt !== 'string' || !Number.isFinite(Date.parse(loan.nextAutomaticPaymentAt))) {
        loan.nextAutomaticPaymentAt = new Date(now + loan.automaticPaymentIntervalSeconds * 1000).toISOString();
      }
    }
    for (const request of (Array.isArray(database.limitIncreaseRequests) ? database.limitIncreaseRequests : [])) {
      if ((request.status || 'En revisión') === 'En revisión'
        && (applySafetyPreset || typeof request.autoApprovalAt !== 'string' || !Number.isFinite(Date.parse(request.autoApprovalAt)))) {
        request.autoApprovalAt = new Date(now + simulationSettingsFor(database).automaticLimitIncreaseApprovalDelaySeconds * 1000).toISOString();
      }
    }
    for (const application of (Array.isArray(database.creditApplications) ? database.creditApplications : [])) {
      if (application?.automaticSimulation === true
        && (application.status || 'En revisión') === 'En revisión'
        && (applySafetyPreset || typeof application.autoApprovalAt !== 'string' || !Number.isFinite(Date.parse(application.autoApprovalAt)))) {
        application.autoApprovalAt = new Date(now + simulationSettingsFor(database).automaticCreditApprovalDelaySeconds * 1000).toISOString();
      }
      const pendingEntry = database.accounts?.[application.accountId]?.card?.pendingDisbursements?.find((entry) => entry.applicationId === application.id);
      const pendingAmount = Math.max(Number(application.cardFundsRemaining) || 0, Number(pendingEntry?.remainingAmount) || 0);
      if (application.status === 'Aprobado' && pendingAmount > 0 && !application.autoAdvancedAt) {
        application.cardFundsRemaining = pendingAmount;
        application.autoAdvanceEnabled = true;
        if (applySafetyPreset || typeof application.autoAdvanceAt !== 'string' || !Number.isFinite(Date.parse(application.autoAdvanceAt))) {
          application.autoAdvanceAt = new Date(now + simulationSettingsFor(database).automaticAdvanceDelaySeconds * 1000).toISOString();
        }
      }
    }
    return automation;
  }

  function simulationSettingsFor(database = db) {
    return { ...freshSimulationSettings(), ...(database?.simulationSettings || {}) };
  }

  function normalizeSimulationSettings(database) {
    if (!database || typeof database !== 'object') return null;
    const saved = database.simulationSettings;
    if (saved !== undefined && (!saved || typeof saved !== 'object' || Array.isArray(saved))) return null;
    if (saved === undefined && database.withdrawalTreasury) {
      // La tarifa nueva debe empezar al actualizar/importar, sin recalcular el tiempo antiguo.
      database.withdrawalTreasury.lastAccruedAt = new Date().toISOString();
    }
    const applySafetyPreset = saved?.automationSafetyPresetVersion !== 1;
    const settings = { ...freshSimulationSettings(), ...(saved || {}) };
    if (applySafetyPreset) {
      Object.assign(settings, {
        creditRequestIntervalSeconds: 3600,
        automaticCreditApprovalDelaySeconds: 60,
        automaticAdvanceDelaySeconds: 30,
        limitIncreaseRequestIntervalSeconds: 86400,
        automaticLimitIncreaseApprovalDelaySeconds: 60,
        paymentInterval6Seconds: 300,
        paymentInterval12Seconds: 180,
        advancePaymentInterval6Seconds: 300,
        advancePaymentInterval12Seconds: 180,
        treasuryDistributionIntervalSeconds: 3600,
        automaticTransferIntervalSeconds: 3600,
        automaticWithdrawalIntervalSeconds: 3600,
        automaticAnalystCapitalReserve: 500000000,
        automationSafetyPresetVersion: 1
      });
    }
    // Los aumentos de cupo siempre se aprueban automáticamente; el analista controla la espera arriba.
    settings.automaticLimitIncreaseApprovalEnabled = true;
    settings.automationSafetyPresetVersion = 1;
    const legacyIntervals = [
      ['creditRequestIntervalSeconds', 'creditRequestIntervalMinutes'],
      ['limitIncreaseRequestIntervalSeconds', 'limitIncreaseRequestIntervalMinutes'],
      ['automaticTransferIntervalSeconds', 'automaticTransferIntervalMinutes'],
      ['automaticWithdrawalIntervalSeconds', 'automaticWithdrawalIntervalMinutes'],
      ['treasuryDistributionIntervalSeconds', 'treasuryDistributionIntervalMinutes'],
      ['paymentInterval6Seconds', 'paymentInterval6Minutes'],
      ['paymentInterval12Seconds', 'paymentInterval12Minutes'],
      ['advancePaymentInterval6Seconds', 'advancePaymentInterval6Minutes'],
      ['advancePaymentInterval12Seconds', 'advancePaymentInterval12Minutes']
    ];
    legacyIntervals.forEach(([secondsKey, minutesKey]) => {
      if (!applySafetyPreset && !Number.isSafeInteger(saved?.[secondsKey]) && Number.isSafeInteger(saved?.[minutesKey]) && saved[minutesKey] >= 1) {
        settings[secondsKey] = saved[minutesKey] * 60;
      }
      delete settings[minutesKey];
    });
    if (!Number.isSafeInteger(saved?.advancePaymentInterval6Seconds) && !Number.isSafeInteger(saved?.advancePaymentInterval6Minutes)) settings.advancePaymentInterval6Seconds = settings.paymentInterval6Seconds;
    if (!Number.isSafeInteger(saved?.advancePaymentInterval12Seconds) && !Number.isSafeInteger(saved?.advancePaymentInterval12Minutes)) settings.advancePaymentInterval12Seconds = settings.paymentInterval12Seconds;
    settings.treasuryTimerIncomeCap = Number.MAX_SAFE_INTEGER;
    settings.analystCapital = Number.isSafeInteger(settings.analystCapital) ? settings.analystCapital : ANALYST_TOTAL_CAPITAL;
    settings.limitIncreaseAmount = Number.isSafeInteger(settings.limitIncreaseAmount) ? settings.limitIncreaseAmount : DEFAULT_LIMIT_INCREASE_AMOUNT;
    const intervals = [settings.automaticCreditApprovalDelaySeconds, settings.automaticAdvanceDelaySeconds, settings.automaticLimitIncreaseApprovalDelaySeconds, settings.creditRequestIntervalSeconds, settings.limitIncreaseRequestIntervalSeconds, settings.treasuryDistributionIntervalSeconds, settings.automaticTransferIntervalSeconds, settings.automaticWithdrawalIntervalSeconds, settings.paymentInterval6Seconds, settings.paymentInterval12Seconds, settings.advancePaymentInterval6Seconds, settings.advancePaymentInterval12Seconds];
    const creditAmounts = [settings.automaticCreditMinimumAmount, settings.automaticCreditMaximumAmount];
    const advanceAmounts = [settings.automaticAdvanceMinimumAmount, settings.automaticAdvanceMaximumAmount];
    const validMoneyRange = (values) => values.every((amount) => Number.isSafeInteger(amount)
      && amount >= MIN_CREDIT_AMOUNT && amount <= MAX_CREDIT_AMOUNT && amount % MIN_CREDIT_AMOUNT === 0);
    if (!Number.isFinite(settings.monthlyInterestRate) || settings.monthlyInterestRate < 0 || settings.monthlyInterestRate > 1
      || !Number.isSafeInteger(settings.treasuryTimerRate) || settings.treasuryTimerRate < 1
      || !Number.isSafeInteger(settings.treasuryTimerIncomeCap) || settings.treasuryTimerIncomeCap < 0
      || !Number.isSafeInteger(settings.analystCapital) || settings.analystCapital < 0
      || !Number.isSafeInteger(settings.automaticAnalystCapitalReserve) || settings.automaticAnalystCapitalReserve < 0
      || !Number.isSafeInteger(settings.limitIncreaseAmount) || settings.limitIncreaseAmount < MIN_CREDIT_AMOUNT || settings.limitIncreaseAmount % MIN_CREDIT_AMOUNT !== 0
      || intervals.some((seconds) => !Number.isSafeInteger(seconds) || seconds < 1 || seconds > 31536000)
      || !validMoneyRange(creditAmounts) || settings.automaticCreditMinimumAmount > settings.automaticCreditMaximumAmount
      || !validMoneyRange(advanceAmounts) || settings.automaticAdvanceMinimumAmount > settings.automaticAdvanceMaximumAmount
      || settings.automaticAdvanceMinimumAmount > settings.automaticCreditMinimumAmount
      || settings.automaticAdvanceMaximumAmount > settings.automaticCreditMaximumAmount
      || !['credit_amount', 'range'].includes(settings.automaticAdvanceMode)
      || ![0, ...VALID_CREDIT_TERMS].includes(settings.automaticCreditTermMonths)) return null;
    database.simulationSettings = settings;
    return settings;
  }

  function automaticPaymentIntervalForTerm(termMonths, database = db, scheduleType = 'credit') {
    const settings = simulationSettingsFor(database);
    if (scheduleType === 'advance') {
      return Number(termMonths) <= 6 ? settings.advancePaymentInterval6Seconds : settings.advancePaymentInterval12Seconds;
    }
    return Number(termMonths) <= 6 ? settings.paymentInterval6Seconds : settings.paymentInterval12Seconds;
  }

  function currentMonthlyInterestRate(database = db) {
    return simulationSettingsFor(database).monthlyInterestRate;
  }

  function formatMonthlyInterestRate(rate = currentMonthlyInterestRate()) {
    return `${(Number(rate) * 100).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;
  }

  function freshDatabase() {
    const savedConfiguration = typeof readSavedSimulationConfiguration === 'function'
      ? readSavedSimulationConfiguration()
      : null;
    const simulationSettings = { ...freshSimulationSettings(), ...(savedConfiguration?.settings || {}) };
    return {
      accounts: ACCOUNT_SEED.map((seed) => seed ? {
        ...seed,
        withdrawalDate: localDateKey(),
        history: [],
        card: { number: seed.cardNumber, limit: MAX_CARD_FUNDS, funds: 0, recoveredFunds: 0, debt: 0, nextInterestDate: null, history: [], pendingDisbursements: [] }
      } : null),
      creditApplications: [],
      loans: [],
      advanceFeesCollected: 0,
      operationFeesCollected: 0,
      limitIncreaseRequests: [],
      auditLog: [],
      simulationSettings,
      simulationAutomation: freshSimulationAutomation(Date.now(), simulationSettings),
      withdrawalTreasury: freshWithdrawalTreasury()
    };
  }

  function freshWithdrawalTreasury() {
    return { name: TREASURY_NAME, accountNumber: TREASURY_ACCOUNT_NUMBER, pin: TREASURY_PIN, balance: 0, history: [], elapsedSeconds: 0, timerIncomeTotal: 0, lastAccruedAt: new Date().toISOString() };
  }

  function normalizeWithdrawalTreasury(database) {
    const legacyReceiver = database.accounts?.[4];
    const hadTreasury = Boolean(database.withdrawalTreasury && typeof database.withdrawalTreasury === 'object' && !Array.isArray(database.withdrawalTreasury));
    const saved = hadTreasury ? database.withdrawalTreasury : {};
    if (hadTreasury && ((saved.balance !== undefined && (!Number.isSafeInteger(saved.balance) || saved.balance < 0))
      || (saved.history !== undefined && (!Array.isArray(saved.history) || saved.history.length > 10000 || saved.history.some((item) => !item || typeof item !== 'object' || (item.amount !== undefined && (!Number.isSafeInteger(item.amount) || item.amount < 0)))))
      || (saved.elapsedSeconds !== undefined && (!Number.isSafeInteger(saved.elapsedSeconds) || saved.elapsedSeconds < 0))
      || (saved.timerIncomeTotal !== undefined && (!Number.isSafeInteger(saved.timerIncomeTotal) || saved.timerIncomeTotal < 0))
      || (saved.lastAccruedAt !== undefined && (typeof saved.lastAccruedAt !== 'string' || Number.isNaN(Date.parse(saved.lastAccruedAt)))))) return null;
    if (!hadTreasury && legacyReceiver && (!Number.isSafeInteger(legacyReceiver.balance) || legacyReceiver.balance < 0 || !Array.isArray(legacyReceiver.history))) return null;
    const treasury = {
      ...freshWithdrawalTreasury(),
      balance: hadTreasury ? (saved.balance ?? 0) : 0,
      history: Array.isArray(saved.history) ? saved.history.slice().map((item) => ({ ...item, amount: Math.round(item.amount || 0) })) : [],
      elapsedSeconds: saved.elapsedSeconds ?? 0,
      timerIncomeTotal: saved.timerIncomeTotal ?? saved.elapsedSeconds ?? 0,
      lastAccruedAt: saved.lastAccruedAt || new Date().toISOString()
    };
    if (!hadTreasury && legacyReceiver) {
      treasury.balance = legacyReceiver.balance;
      treasury.history = legacyReceiver.history.slice(0, 10000).map((item) => ({ ...item, amount: Math.round(Number(item.amount) || 0) }));
    }
    database.accounts = database.accounts.slice(0, MAX_ACCOUNT_ID + 1);
    database.withdrawalTreasury = treasury;
    return treasury;
  }

  function appendTreasuryAuditEvent(database, movement) {
    if (!Array.isArray(database.auditLog)) database.auditLog = [];
    const existing = database.auditLog.find((event) => event.id === movement.id);
    const event = {
      id: typeof movement.id === 'string' ? movement.id : createId(),
      date: movement.date || new Date().toISOString(),
      action: movement.type === 'timer_income' ? 'Acumulación automática de tesorería' : movement.type === 'withdrawal_received' ? 'Retiro acreditado a tesorería' : movement.type === 'deposit_funded' ? 'Depósito financiado por Tesorería' : movement.type === 'equal_distribution' ? 'Tesorería distribuida en partes iguales' : 'Movimiento de Tesorería',
      category: 'tesoreria', accountId: null, accountName: TREASURY_NAME, source: movement.type === 'timer_income' ? 'Temporizador' : 'Tesorería',
      amount: Math.max(0, Math.round(Number(movement.amount) || 0)), direction: movement.direction || null,
      description: String(movement.description || '').slice(0, 400), referenceId: movement.id || null, details: { movementType: movement.type || 'movement', ratePesosPerSecond: movement.ratePesosPerSecond || null, elapsedSeconds: movement.elapsedSeconds || null, perAccountAmount: movement.perAccountAmount || null }
    };
    if (existing) Object.assign(existing, event);
    else database.auditLog.unshift(event);
    if (database.auditLog.length > MAX_AUDIT_EVENTS) database.auditLog.length = MAX_AUDIT_EVENTS;
  }

  function recordTreasuryMovement(type, amount, description, direction = null, date = new Date().toISOString(), metadata = {}) {
    const treasury = db?.withdrawalTreasury;
    if (!treasury || !Number.isSafeInteger(amount) || amount < 0) return null;
    const item = { id: createId(), type, amount, description: String(description || ''), direction, date, ...metadata };
    treasury.history.unshift(item);
    const compactedHistory = compactMovementHistory(treasury.history, MAX_TREASURY_HISTORY_ITEMS);
    if (compactedHistory.compacted) treasury.history = compactedHistory.history;
    appendTreasuryAuditEvent(db, item);
    return item;
  }

  function accrueWithdrawalTreasury(database = db, now = Date.now()) {
    if (database === db && (database?.simulationAutomation?.paused || (typeof simulationAutomationProcessing !== 'undefined' && !simulationAutomationProcessing
      && typeof nextSimulationAutomationEvent === 'function'))) {
      if (database?.simulationAutomation?.paused) return false;
      const overdueEvent = nextSimulationAutomationEvent();
      if (overdueEvent && overdueEvent.at <= now) return false;
    }
    const treasury = database?.withdrawalTreasury;
    if (!treasury || !Number.isSafeInteger(treasury.balance) || !Number.isFinite(now)) return false;
    const last = Date.parse(treasury.lastAccruedAt);
    if (!Number.isFinite(last) || last > now) { treasury.lastAccruedAt = new Date(now).toISOString(); return false; }
    const seconds = Math.floor((now - last) / 1000);
    if (seconds < 1) return false;
    if (!Number.isSafeInteger(treasury.timerIncomeTotal) || treasury.timerIncomeTotal < 0) {
      treasury.timerIncomeTotal = Math.max(0, Math.round(Number(treasury.elapsedSeconds) || 0));
    }
    const settings = simulationSettingsFor(database);
    const rate = settings.treasuryTimerRate;
    const remainingTimerIncome = Math.max(0, settings.treasuryTimerIncomeCap - treasury.timerIncomeTotal);
    const balanceRoom = Number.MAX_SAFE_INTEGER - treasury.balance;
    if (remainingTimerIncome === 0 || balanceRoom <= 0) { treasury.lastAccruedAt = new Date(now).toISOString(); return false; }
    const income = Math.min(remainingTimerIncome, balanceRoom, seconds >= Math.ceil(remainingTimerIncome / rate) ? remainingTimerIncome : seconds * rate);
    if (!Number.isSafeInteger(income) || income <= 0 || seconds > Number.MAX_SAFE_INTEGER - treasury.elapsedSeconds
      || income > Number.MAX_SAFE_INTEGER - treasury.timerIncomeTotal) return false;
    const accruedSecondsThisEntry = Math.min(seconds, Math.ceil(income / rate));
    const latest = treasury.history[0];
    const canExtendLatestTimer = latest?.type === 'timer_income' && latest.ratePesosPerSecond === rate;
    if (canExtendLatestTimer && income > Number.MAX_SAFE_INTEGER - latest.amount) return false;
    const accruedSeconds = (canExtendLatestTimer ? Number(latest.elapsedSeconds) || 0 : 0) + accruedSecondsThisEntry;
    const accruedAmount = (canExtendLatestTimer ? latest.amount : 0) + income;
    const item = canExtendLatestTimer
      ? { ...latest, amount: accruedAmount, elapsedSeconds: accruedSeconds, description: `Temporizador: ${accruedSeconds} segundo(s) a $${rate} por segundo`, direction: 'in', date: new Date(now).toISOString() }
      : { id: createId(), type: 'timer_income', amount: income, elapsedSeconds: accruedSecondsThisEntry, ratePesosPerSecond: rate, description: `Temporizador: ${accruedSecondsThisEntry} segundo(s) a $${rate} por segundo`, direction: 'in', date: new Date(now).toISOString() };
    treasury.balance += income;
    treasury.timerIncomeTotal += income;
    treasury.elapsedSeconds += accruedSecondsThisEntry;
    const reachedLimit = treasury.timerIncomeTotal >= settings.treasuryTimerIncomeCap || income >= balanceRoom;
    treasury.lastAccruedAt = new Date(reachedLimit ? now : last + seconds * 1000).toISOString();
    if (canExtendLatestTimer) treasury.history[0] = item;
    else treasury.history.unshift(item);
    const compactedHistory = compactMovementHistory(treasury.history, MAX_TREASURY_HISTORY_ITEMS);
    if (compactedHistory.compacted) treasury.history = compactedHistory.history;
    appendTreasuryAuditEvent(database, item);
    return true;
  }

  function migrateLegacyCardDebts(database) {
    if (!database || !Array.isArray(database.loans)) return;
    for (let accountId = 1; accountId <= MAX_ACCOUNT_ID; accountId += 1) {
      const card = database.accounts?.[accountId]?.card;
      if (!card) continue;
      const legacyDebt = Math.max(0, Math.round(Number(card.debt) || 0));
      if (legacyDebt <= 0) {
        card.debt = 0;
        card.nextInterestDate = null;
        continue;
      }
      const active = database.loans.find((loan) => loan.accountId === accountId && loan.status === 'Activo' && Number(loan.outstandingPrincipal) > 0);
      if (active) {
        active.outstandingPrincipal = roundMoney(active.outstandingPrincipal + legacyDebt);
        active.reborrowedCapitalTotal = roundMoney((Number(active.reborrowedCapitalTotal) || 0) + legacyDebt);
        active.originalDisbursedTotal = Math.max(0, roundMoney(Number.isFinite(active.originalDisbursedTotal) ? active.originalDisbursedTotal : (active.source === 'Avance de capital recuperado' ? 0 : Number(active.principalOriginal) || 0)));
        active.principalOriginal = active.originalDisbursedTotal;
        active.source = active.originalDisbursedTotal > 0 ? 'Crédito unificado' : 'Avance de capital recuperado';
        const paid = Math.max(0, Number(active.installmentsPaid) || 0);
        active.monthlyRate = Number.isFinite(active.monthlyRate) ? active.monthlyRate : currentMonthlyInterestRate(database);
        active.termMonths = paid + 60;
        active.monthlyPayment = calculateCreditEstimate(active.outstandingPrincipal, 60, active.monthlyRate).monthlyPayment;
        active.nextDueDate = addMonthsToDate(localDateKey(), 1);
      } else {
        const migratedLoan = createLoanFromCardAdvance(accountId, legacyDebt);
        if (migratedLoan) database.loans.push(migratedLoan);
      }
      card.debt = 0;
      card.nextInterestDate = null;
      if (!Array.isArray(card.history)) card.history = [];
      card.history.unshift({ id: createId(), type: 'card_debt_unified', amount: legacyDebt, description: 'Saldo heredado integrado en la deuda única de crédito', direction: 'out', date: new Date().toISOString() });
    }
  }
