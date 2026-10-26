  const SIMULATION_AUTOMATION_TICK_MS = 1000;
  function automaticAdvanceIsScheduled(application) {
    return application?.automaticSimulation === true || application?.autoAdvanceEnabled === true
      || (typeof application?.autoApprovedAt === 'string' && Number.isFinite(Date.parse(application.autoApprovedAt)))
      || (typeof application?.autoAdvanceAt === 'string' && Number.isFinite(Date.parse(application.autoAdvanceAt)));
  }
  function scheduledAdvanceAmountForApplication(application) {
    if (!application) return 0;
    const pending = db?.accounts?.[application.accountId]?.card?.pendingDisbursements;
    const entry = Array.isArray(pending) ? pending.find((item) => item.applicationId === application.id) : null;
    const queuedAmount = Math.max(0, roundMoney(Number(entry?.remainingAmount) || 0));
    return queuedAmount || Math.max(0, roundMoney(Number(application.cardFundsRemaining) || 0));
  }
  const SIMULATION_AUTOMATION_SAVE_MS = 15000;
  const SIMULATION_AUTOMATION_EVENT_LIMIT = 20000;
  let simulationAutomationTimerId = null;
  let simulationAutomationLastSavedAt = Date.now();
  let simulationAutomationProcessing = false;
  let simulationAutomationInitialSaveDone = false;

  function automaticCreditPendingApplications(exceptId = null) {
    return (Array.isArray(db?.creditApplications) ? db.creditApplications : [])
      .filter((application) => application?.automaticSimulation === true
        && application.id !== exceptId
        && (application.status || 'En revisión') === 'En revisión');
  }

  function automaticCreditReservedAmount(exceptId = null) {
    return roundMoney(automaticCreditPendingApplications(exceptId)
      .reduce((total, application) => total + Math.max(0, Number(application.amount) || 0), 0));
  }

  function automaticLimitIncreaseReservedAmount(exceptRequestId = null) {
    return roundMoney((Array.isArray(db?.limitIncreaseRequests) ? db.limitIncreaseRequests : [])
      .filter((request) => request.id !== exceptRequestId && (request.status || 'En revisión') === 'En revisión')
      .reduce((total, request) => total + Math.max(0, Number(request.increaseAmount)
        || (Number(request.requestedLimit) - Number(request.previousLimit)) || 0), 0));
  }

  function automaticAnalystCapitalAvailable(exceptApplicationId = null, exceptRequestId = null) {
    const settings = simulationSettingsFor(db);
    const reserve = Math.min(settings.analystCapital, settings.automaticAnalystCapitalReserve);
    const reserved = automaticCreditReservedAmount(exceptApplicationId)
      + automaticLimitIncreaseReservedAmount(exceptRequestId);
    return Math.max(0, roundMoney(availableAnalystCapital() - reserve - reserved));
  }

  function automaticCreditCapacityForAccount(accountId, exceptApplicationId = null) {
    const current = db?.accounts?.[accountId];
    const card = current?.card;
    if (!current || !card) return 0;
    const analystSpace = automaticAnalystCapitalAvailable(exceptApplicationId);
    const personalSpace = availablePersonalCreditForAccount(accountId);
    const cardSpace = Math.max(0, cardLimitForRecord(card) - availableAdvancesForCard(card));
    const savingsSpace = Math.max(0, maxSavingsBalanceForAccount(accountId) - current.balance + ADVANCE_FEE);
    const maximum = Math.min(simulationSettingsFor(db).automaticCreditMaximumAmount, analystSpace, personalSpace, cardSpace, savingsSpace);
    return Math.floor(maximum / MIN_CREDIT_AMOUNT) * MIN_CREDIT_AMOUNT;
  }

  function randomIntegerBetween(minimum, maximum) {
    return Math.floor(Math.random() * (maximum - minimum + 1)) + minimum;
  }

  function generateAutomaticCreditRequests(requestedAt) {
    const settings = simulationSettingsFor(db);
    const applicationDate = new Date(requestedAt).toISOString();
    const purposes = ['Libre inversión', 'Estudio', 'Vivienda o mejoras', 'Vehículo', 'Consolidación de deudas', 'Emergencia personal', 'Otro'];
    const employments = ['Empleado', 'Independiente', 'Pensionado', 'Otro'];
    let generated = 0;
    for (let accountId = 1; accountId <= MAX_ACCOUNT_ID; accountId += 1) {
      const current = db.accounts[accountId];
      if (!current || pendingCreditApplicationForAccount(accountId)) continue;
      const maximum = automaticCreditCapacityForAccount(accountId);
      const minimumSteps = Math.ceil(settings.automaticCreditMinimumAmount / MIN_CREDIT_AMOUNT);
      const maximumSteps = Math.floor(maximum / MIN_CREDIT_AMOUNT);
      if (maximumSteps < minimumSteps) continue;
      const amount = randomIntegerBetween(minimumSteps, maximumSteps) * MIN_CREDIT_AMOUNT;
      const termMonths = settings.automaticCreditTermMonths || VALID_CREDIT_TERMS[Math.floor(Math.random() * VALID_CREDIT_TERMS.length)];
      const monthlyRate = currentMonthlyInterestRate();
      const estimate = calculateCreditEstimate(amount, termMonths, monthlyRate);
      const application = {
        id: createId(),
        accountId,
        applicantName: current.name,
        accountNumber: current.accountNumber,
        amount,
        monthlyIncome: randomIntegerBetween(1500000, 12000000),
        termMonths,
        monthlyRate,
        employment: employments[randomIntegerBetween(0, employments.length - 1)],
        purpose: purposes[randomIntegerBetween(0, purposes.length - 1)],
        monthlyPayment: estimate.monthlyPayment,
        totalPayable: estimate.totalPayable,
        totalInterest: estimate.totalInterest,
        status: 'En revisión',
        date: applicationDate,
        automaticSimulation: true,
        autoApprovalAt: new Date(requestedAt + settings.automaticCreditApprovalDelaySeconds * 1000).toISOString(),
        origin: 'Crédito'
      };
      db.creditApplications.unshift(application);
      recordAuditEvent('Solicitud automática de crédito generada', {
        category: 'creditos', accountId, amount, source: 'Simulación', referenceId: application.id,
        description: 'Solicitud automática aleatoria dentro de los montos y topes configurados.',
        details: { termMonths, monthlyRate, autoApprovalAt: application.autoApprovalAt }, date: applicationDate
      });
      generated += 1;
    }
    return generated;
  }

  function generateAutomaticLimitIncreaseRequests(requestedAt) {
    if (!Array.isArray(db.limitIncreaseRequests)) db.limitIncreaseRequests = [];
    const requestDate = new Date(requestedAt).toISOString();
    const increaseAmount = simulationSettingsFor(db).limitIncreaseAmount;
    let generated = 0;
    for (let accountId = 1; accountId <= MAX_ACCOUNT_ID; accountId += 1) {
      const current = db.accounts[accountId];
      if (!current?.card || automaticAnalystCapitalAvailable() < increaseAmount) continue;
      const hasPending = db.limitIncreaseRequests.some((request) => request.accountId === accountId && (request.status || 'En revisión') === 'En revisión');
      if (hasPending) continue;
      const previousLimit = cardCreditLimitForAccount(accountId);
      const requestedLimit = roundMoney(previousLimit + increaseAmount);
      if (requestedLimit > MAX_CARD_LIMIT) continue;
      const request = {
        id: createId(), accountId, applicantName: current.name, accountNumber: current.accountNumber,
        previousLimit, increaseAmount, requestedLimit, termMonths: 12, status: 'En revisión', date: requestDate,
        automaticSimulation: true,
        autoApprovalAt: new Date(requestedAt + simulationSettingsFor(db).automaticLimitIncreaseApprovalDelaySeconds * 1000).toISOString()
      };
      db.limitIncreaseRequests.unshift(request);
      recordAuditEvent('Solicitud automática de aumento de cupo generada', {
        category: 'cupo', accountId, amount: increaseAmount, source: 'Simulación', referenceId: request.id,
        description: 'Solicitud de aumento generada automáticamente; se aprobará al cumplirse el tiempo configurado.',
        details: { previousLimit, requestedLimit, termMonths: 12 }, date: requestDate
      });
      generated += 1;
    }
    return generated;
  }

  function deferAutomaticLimitIncreaseApproval(request, approvalAt) {
    request.autoApprovalAt = new Date(approvalAt + simulationSettingsFor(db).automaticLimitIncreaseApprovalDelaySeconds * 1000).toISOString();
    return true;
  }

  function approveAutomaticLimitIncreaseRequest(request, approvalAt) {
    if (!request || (request.status || 'En revisión') !== 'En revisión') return false;
    const target = db.accounts?.[request.accountId];
    const currentLimit = target ? cardCreditLimitForAccount(request.accountId) : 0;
    const increaseAmount = roundMoney(Number(request.requestedLimit) - currentLimit);
    const date = new Date(approvalAt).toISOString();
    const reject = (message) => {
      request.status = 'Rechazado';
      request.approvedLimit = null;
      request.disbursedAmount = 0;
      request.reviewerName = REVIEWER_NAME;
      request.reviewerNote = message;
      request.reviewedAt = date;
      request.autoApprovalAt = date;
      recordAuditEvent('Aumento de cupo rechazado automáticamente', {
        category: 'cupo', accountId: request.accountId, amount: increaseAmount, source: 'Analista automático', referenceId: request.id,
        description: message, details: { requestedLimit: request.requestedLimit }, date
      });
      return true;
    };
    if (!target?.card || !Number.isSafeInteger(increaseAmount) || increaseAmount <= 0 || request.requestedLimit !== currentLimit + increaseAmount || request.requestedLimit > MAX_CARD_LIMIT) {
      return reject('La solicitud superaría el rango numérico seguro o el aumento ya no coincide con el cupo actual.');
    }
    const analystAvailable = automaticAnalystCapitalAvailable(null, request.id);
    const exposure = outstandingCreditExposureForAccount(request.accountId);
    if (increaseAmount > analystAvailable || exposure + increaseAmount > request.requestedLimit
      || availableAdvancesForCard(target.card) + increaseAmount > request.requestedLimit) {
      return deferAutomaticLimitIncreaseApproval(request, approvalAt);
    }
    const estimate = calculateCreditEstimate(increaseAmount, 12, currentMonthlyInterestRate());
    const application = {
      id: createId(), accountId: request.accountId, applicantName: target.name, accountNumber: target.accountNumber,
      amount: increaseAmount, monthlyIncome: 0, termMonths: 12, monthlyRate: currentMonthlyInterestRate(),
      autoAdvanceEnabled: true, autoAdvanceAt: new Date(approvalAt + simulationSettingsFor(db).automaticAdvanceDelaySeconds * 1000).toISOString(),
      employment: 'Aumento de cupo',
      purpose: `Desembolso automático por aumento de cupo (${money(currentLimit)} a ${money(request.requestedLimit)})`,
      monthlyPayment: estimate.monthlyPayment, totalPayable: estimate.totalPayable, totalInterest: estimate.totalInterest,
      status: 'Aprobado', date, reviewedAt: date, disbursedAt: date, reviewerName: REVIEWER_NAME,
      reviewerNote: 'Aprobación automática según la configuración del analista.', origin: 'Aumento de cupo',
      limitIncreaseRequestId: request.id, activatedAmount: 0, cardFundsRemaining: 0
    };
    if (!queueCardDisbursement(request.accountId, application, increaseAmount)) {
      return deferAutomaticLimitIncreaseApproval(request, approvalAt);
    }
    target.card.limit = roundMoney(request.requestedLimit);
    target.card.funds = roundMoney(target.card.funds + increaseAmount);
    if (!Array.isArray(db.creditApplications)) db.creditApplications = [];
    db.creditApplications.unshift(application);
    request.status = 'Aprobado';
    request.approvedLimit = target.card.limit;
    request.disbursedAmount = increaseAmount;
    request.disbursedAt = date;
    request.loanId = null;
    request.creditApplicationId = application.id;
    request.cardFundsRemaining = increaseAmount;
    request.activatedAmount = 0;
    request.reviewerName = REVIEWER_NAME;
    request.reviewerNote = 'Aprobación automática; el crédito solo se activa cuando realices avances y conserva el plazo de 12 meses.';
    request.reviewedAt = date;
    request.autoApprovalAt = date;
    recordCardMovement(request.accountId, 'card_disbursement', increaseAmount, `Desembolso automático por aumento de cupo ${String(request.id).slice(-7)}; crédito pendiente de avance`, 'in', date);
    recordMovement(request.accountId, 'card_disbursement', increaseAmount, 'Aumento de cupo acreditado automáticamente a tarjeta; el crédito no se activa hasta realizar avances', null, date);
    recordAuditEvent('Aumento de cupo aprobado automáticamente y fondos desembolsados', {
      category: 'cupo', accountId: request.accountId, amount: increaseAmount, source: 'Analista automático', referenceId: request.id,
      description: `Nuevo cupo ${money(target.card.limit)}; los fondos se cargaron a la tarjeta y el crédito queda pendiente de avances.`,
      details: { previousLimit: currentLimit, approvedLimit: target.card.limit, loanActivated: false, cardFundsRemaining: increaseAmount, termMonths: 12 }, date
    });
    return true;
  }

  function distributeTreasuryEqually(distributedAt) {
    const treasury = db?.withdrawalTreasury;
    const clients = (db?.accounts || []).slice(1, MAX_ACCOUNT_ID + 1).filter(Boolean);
    const commissionPerAccount = TREASURY_DISTRIBUTION_FEE;
    if (!treasury || clients.length !== MAX_ACCOUNT_ID || treasury.balance <= commissionPerAccount * MAX_ACCOUNT_ID) return 0;
    const grossCapacity = Math.min(...clients.map((current) => Math.max(0, maxSavingsBalanceForAccount(current.id) - current.balance + commissionPerAccount)));
    const grossPerAccount = Math.min(Math.floor(treasury.balance / MAX_ACCOUNT_ID), grossCapacity);
    if (grossPerAccount <= commissionPerAccount) return 0;
    const netPerAccount = grossPerAccount - commissionPerAccount;
    const total = grossPerAccount * MAX_ACCOUNT_ID;
    const totalCommission = commissionPerAccount * MAX_ACCOUNT_ID;
    const date = new Date(distributedAt).toISOString();
    treasury.balance -= total;
    db.operationFeesCollected = roundMoney((Number(db.operationFeesCollected) || 0) + totalCommission);
    recordTreasuryMovement('equal_distribution', total, `Reparto automático: ${money(netPerAccount)} netos por cuenta y comisión de ${money(commissionPerAccount)} por cuenta`, 'out', date, {
      perAccountAmount: grossPerAccount, netPerAccountAmount: netPerAccount, commissionPerAccount, commissionTotal: totalCommission
    });
    clients.forEach((current) => {
      current.balance = roundMoney(current.balance + netPerAccount);
      recordMovement(current.id, 'treasury_distribution', grossPerAccount, `Abono bruto de Tesorería; comisión de ${money(commissionPerAccount)} descontada del reparto`, 'in', date);
      recordMovement(current.id, 'operation_fee', commissionPerAccount, 'Comisión por reparto automático de Tesorería', 'out', date);
    });
    recordAuditEvent('Reparto automático de Tesorería con comisión', {
      category: 'tesoreria', amount: total, source: 'Simulación', referenceId: createId(),
      description: `Se distribuyeron ${money(netPerAccount)} netos a cada cuenta y se cobraron ${money(commissionPerAccount)} por cuenta.`,
      details: { grossPerAccount, netPerAccount, commissionPerAccount, commissionTotal: totalCommission }, date
    });
    return total;
  }

  function executeAutomaticTransfer(transferAt) {
    const clients = (db?.accounts || []).slice(1, MAX_ACCOUNT_ID + 1).filter(Boolean);
    const sources = clients.filter((current) => Number(current.balance) > OPERATION_FEE + MIN_CREDIT_AMOUNT);
    if (sources.length === 0) return false;
    const startIndex = randomIntegerBetween(0, sources.length - 1);
    for (let offset = 0; offset < sources.length; offset += 1) {
      const source = sources[(startIndex + offset) % sources.length];
      const destinations = clients.filter((current) => current.id !== source.id
        && maxSavingsBalanceForAccount(current.id) - current.balance >= MIN_CREDIT_AMOUNT);
      if (destinations.length === 0) continue;
      const destination = destinations[randomIntegerBetween(0, destinations.length - 1)];
      const maximum = Math.min(MAX_TRANSFER_AMOUNT, source.balance - OPERATION_FEE, maxSavingsBalanceForAccount(destination.id) - destination.balance);
      const maximumSteps = Math.floor(maximum / MIN_CREDIT_AMOUNT);
      if (maximumSteps < 1) continue;
      const amount = randomIntegerBetween(1, maximumSteps) * MIN_CREDIT_AMOUNT;
      const date = new Date(transferAt).toISOString();
      source.balance = roundMoney(source.balance - amount - OPERATION_FEE);
      destination.balance = roundMoney(destination.balance + amount);
      db.operationFeesCollected = roundMoney((Number(db.operationFeesCollected) || 0) + OPERATION_FEE);
      recordMovement(source.id, 'transfer', amount, `Transferencia automática aleatoria enviada a ${destination.name}`, 'out', date);
      recordMovement(source.id, 'operation_fee', OPERATION_FEE, 'Comisión por transferencia automática', 'out', date);
      recordMovement(destination.id, 'transfer', amount, `Transferencia automática aleatoria recibida de ${source.name}`, 'in', date);
      recordAuditEvent('Transferencia automática aleatoria entre cuentas', {
        category: 'transferencias', accountId: source.id, amount, source: 'Simulación', referenceId: createId(),
        description: `Se enviaron fondos a ${destination.name}; comisión ${money(OPERATION_FEE)}.`,
        details: { sourceAccountId: source.id, destinationAccountId: destination.id, fee: OPERATION_FEE }, date
      });
      return true;
    }
    return false;
  }

  function executeAutomaticWithdrawal(withdrawalAt) {
    const treasury = db?.withdrawalTreasury;
    if (!treasury || !Number.isSafeInteger(treasury.balance)) return false;
    const treasuryRoom = Number.MAX_SAFE_INTEGER - treasury.balance;
    if (treasuryRoom < MIN_CREDIT_AMOUNT) return false;
    const clients = (db?.accounts || []).slice(1, MAX_ACCOUNT_ID + 1).filter(Boolean);
    const eligible = clients.filter((current) => Number(current.balance) > OPERATION_FEE + MIN_CREDIT_AMOUNT);
    if (eligible.length === 0) return false;
    const current = eligible[randomIntegerBetween(0, eligible.length - 1)];
    resetDailyWithdrawalIfNeeded(current);
    const maximum = Math.min(MAX_WITHDRAWAL_AMOUNT, current.balance - OPERATION_FEE, treasuryRoom);
    const maximumSteps = Math.floor(maximum / MIN_CREDIT_AMOUNT);
    if (maximumSteps < 1) return false;
    const amount = randomIntegerBetween(1, maximumSteps) * MIN_CREDIT_AMOUNT;
    const date = new Date(withdrawalAt).toISOString();
    current.balance = roundMoney(current.balance - amount - OPERATION_FEE);
    current.withdrawnToday = roundMoney((Number(current.withdrawnToday) || 0) + amount);
    treasury.balance += amount;
    db.operationFeesCollected = roundMoney((Number(db.operationFeesCollected) || 0) + OPERATION_FEE);
    recordMovement(current.id, 'withdraw', amount, `Retiro automático aleatorio dirigido a ${TREASURY_NAME}`, 'out', date);
    recordMovement(current.id, 'operation_fee', OPERATION_FEE, 'Comisión por retiro automático', 'out', date);
    recordTreasuryMovement('withdrawal_received', amount, `Retiro automático recibido de ${current.name}`, 'in', date);
    recordAuditEvent('Retiro automático aleatorio acreditado a Tesorería', {
      category: 'retiros', accountId: current.id, amount, source: 'Simulación', referenceId: createId(),
      description: `Retiro dirigido a ${TREASURY_NAME}; comisión ${money(OPERATION_FEE)}.`,
      details: { fee: OPERATION_FEE }, date
    });
    return true;
  }
  function deferAutomaticCreditApproval(application, approvalAt) {
    application.autoApprovalAt = new Date(approvalAt + simulationSettingsFor(db).automaticCreditApprovalDelaySeconds * 1000).toISOString();
    application.autoApprovalDeferredAt = new Date(approvalAt).toISOString();
    return true;
  }

  function deferAutomaticCreditAdvance(application, advanceAt, reason = 'El avance no pudo completarse con los fondos disponibles.') {
    const previousIssue = application.autoAdvanceIssue;
    const retryBase = Math.max(advanceAt, Date.now());
    application.autoAdvanceAt = new Date(retryBase + simulationSettingsFor(db).automaticAdvanceDelaySeconds * 1000).toISOString();
    application.autoAdvanceDeferredAt = new Date(advanceAt).toISOString();
    application.autoAdvanceIssue = reason;
    if (previousIssue !== reason) {
      recordAuditEvent('Avance automático pendiente', {
        category: 'creditos', accountId: application.accountId, amount: Number(application.cardFundsRemaining) || 0,
        source: 'Sistema', referenceId: application.id, description: reason,
        details: { retryAt: application.autoAdvanceAt }, date: new Date(advanceAt).toISOString()
      });
    }
    return true;
  }

  function approveAutomaticCreditAndDisburse(application, approvalAt) {
    const amount = roundMoney(application.amount);
    const accountId = application.accountId;
    const current = db.accounts[accountId];
    const settings = simulationSettingsFor(db);
    const capacity = automaticCreditCapacityForAccount(accountId, application.id);
    if (!current || amount < settings.automaticCreditMinimumAmount || amount > capacity) {
      return deferAutomaticCreditApproval(application, approvalAt);
    }
    const date = new Date(approvalAt).toISOString();
    const card = current.card;
    if (!card) return deferAutomaticCreditApproval(application, approvalAt);
    card.pendingDisbursements = Array.isArray(card.pendingDisbursements) ? card.pendingDisbursements : [];
    application.disbursedAt = date;
    card.funds = roundMoney(card.funds + amount);
    if (!queueCardDisbursement(accountId, application, amount)) {
      card.funds = roundMoney(card.funds - amount);
      application.disbursedAt = null;
      return deferAutomaticCreditApproval(application, approvalAt);
    }
    const entryIndex = card.pendingDisbursements.findIndex((entry) => entry.applicationId === application.id);
    if (entryIndex > 0) {
      const [ownEntry] = card.pendingDisbursements.splice(entryIndex, 1);
      card.pendingDisbursements.unshift(ownEntry);
    }

    application.reviewerName = REVIEWER_NAME;
    application.reviewerDecision = 'Aprobado';
    application.reviewerNote = 'Aprobación automática. Los fondos están en la tarjeta; el avance se realizará tras la espera configurada.';
    application.reviewedAt = date;
    application.disbursedAt = date;
    application.autoApprovedAt = date;
    application.autoApprovalAt = date;
    application.autoAdvanceEnabled = true;
    application.autoAdvanceAt = new Date(approvalAt + settings.automaticAdvanceDelaySeconds * 1000).toISOString();
    application.autoAdvanceDeferredAt = null;
    application.autoAdvanceIssue = null;
    application.status = 'Aprobado';
    recordCardMovement(accountId, 'card_disbursement', amount, 'Desembolso automático cargado a la tarjeta', 'in', date);
    recordMovement(accountId, 'card_disbursement', amount, 'Desembolso automático acreditado a la tarjeta', null, date);
    recordAuditEvent('Crédito aprobado y desembolsado a tarjeta', {
      category: 'creditos', accountId, amount, source: 'Analista automático', referenceId: application.id,
      description: 'Los fondos quedaron en tarjeta. La deuda se activará cuando ocurra el avance automático configurado.',
      details: { loanActivated: false, cardFundsRemaining: amount, autoAdvanceAt: application.autoAdvanceAt, termMonths: application.termMonths }, date
    });
    return true;
  }

  function advanceApprovedAutomaticCredit(application, advanceAt) {
    if (!application || application.status !== 'Aprobado' || application.autoAdvancedAt) return false;
    const accountId = application.accountId;
    const current = db.accounts?.[accountId];
    const card = current?.card;
    const settings = simulationSettingsFor(db);
    const amount = scheduledAdvanceAmountForApplication(application);
    if (amount > 0 && Number(application.cardFundsRemaining) !== amount) application.cardFundsRemaining = amount;
    if (!current || !card || amount <= 0 || card.funds < amount) return deferAutomaticCreditAdvance(application, advanceAt, 'La tarjeta no contiene el total pendiente registrado para este crédito.');

    const savingsSpace = Math.max(0, maxSavingsBalanceForAccount(accountId) - current.balance + ADVANCE_FEE);
    const maximumAdvance = Math.min(amount, settings.automaticAdvanceMaximumAmount, savingsSpace);
    const minimumAdvanceSteps = Math.ceil(settings.automaticAdvanceMinimumAmount / MIN_CREDIT_AMOUNT);
    const maximumAdvanceSteps = Math.floor(maximumAdvance / MIN_CREDIT_AMOUNT);
    const advanceFullCredit = settings.automaticAdvanceMode === 'credit_amount';
    if (advanceFullCredit ? amount > savingsSpace : maximumAdvanceSteps < minimumAdvanceSteps) {
      return deferAutomaticCreditAdvance(application, advanceAt, 'La cuenta no tiene espacio suficiente en ahorros para realizar el avance configurado.');
    }
    const advanceAmount = advanceFullCredit
      ? amount
      : randomIntegerBetween(minimumAdvanceSteps, maximumAdvanceSteps) * MIN_CREDIT_AMOUNT;

    card.pendingDisbursements = Array.isArray(card.pendingDisbursements) ? card.pendingDisbursements : [];
    const entryIndex = card.pendingDisbursements.findIndex((entry) => entry.applicationId === application.id);
    if (entryIndex > 0) {
      const [ownEntry] = card.pendingDisbursements.splice(entryIndex, 1);
      card.pendingDisbursements.unshift(ownEntry);
    }
    const date = new Date(advanceAt).toISOString();
    const activation = activatePendingCardDisbursements(accountId, advanceAmount, application.termMonths, date);
    if (!activation.ok || activation.activatedAmount !== advanceAmount) return deferAutomaticCreditAdvance(application, advanceAt, activation.error || 'No se pudo validar la asignación de los fondos de la tarjeta.');

    card.funds = roundMoney(Math.max(0, card.funds - advanceAmount));
    current.balance = roundMoney(current.balance + advanceAmount - ADVANCE_FEE);
    db.advanceFeesCollected = roundMoney((Number(db.advanceFeesCollected) || 0) + ADVANCE_FEE);
    recordCardMovement(accountId, 'card_advance', advanceAmount, 'Avance automático de fondos desembolsados a ahorros', 'out', date);
    recordMovement(accountId, 'card_advance', advanceAmount, 'Avance automático de tarjeta recibido en ahorros', 'in', date);
    recordCardMovement(accountId, 'card_advance_fee', ADVANCE_FEE, 'Costo del avance automático', 'out', date);
    recordMovement(accountId, 'card_advance_fee', ADVANCE_FEE, 'Comisión por avance automático', 'out', date);
    const remainingFunds = scheduledAdvanceAmountForApplication(application);
    if (remainingFunds > 0) {
      application.autoAdvancedAt = null;
      application.autoAdvanceAt = new Date(advanceAt + settings.automaticAdvanceDelaySeconds * 1000).toISOString();
    } else {
      application.autoAdvancedAt = date;
      application.autoAdvanceAt = null;
    }
    application.autoAdvanceIssue = null;
    recordAuditEvent('Fondos de crédito avanzados automáticamente', {
      category: 'creditos', accountId, amount: advanceAmount, source: 'Analista automático', referenceId: application.id,
      description: 'Los fondos pasaron de tarjeta a ahorros tras la espera configurada; el crédito se activó por el importe avanzado.',
      details: { loanId: application.loanId, creditAmount: amount, advanceAmount, remainingFunds, advanceMode: settings.automaticAdvanceMode, termMonths: application.termMonths, fee: ADVANCE_FEE }, date
    });
    return true;
  }

  function processAutomaticInstallment(loan, paymentAt) {
    const current = db.accounts[loan.accountId];
    const installment = nextInstallmentFor(loan);
    const intervalSeconds = automaticPaymentIntervalForLoan(loan);
    const date = new Date(paymentAt).toISOString();
    if (!current || installment.paymentAmount <= 0) {
      loan.status = 'Pagado';
      loan.outstandingPrincipal = 0;
      loan.closedAt = date;
      loan.nextAutomaticPaymentAt = null;
      return true;
    }
    if (current.balance < installment.paymentAmount) {
      loan.nextAutomaticPaymentAt = new Date(paymentAt + intervalSeconds * 1000).toISOString();
      recordAuditEvent('Cuota automática reintentada por saldo insuficiente', {
        category: 'creditos', accountId: loan.accountId, amount: installment.paymentAmount,
        source: 'Sistema', referenceId: loan.id,
        description: 'La cuenta tenía ' + money(current.balance) + '; se reintentará en el siguiente intervalo.',
        details: { installmentNumber: installment.installmentNumber, intervalSeconds, retryAt: loan.nextAutomaticPaymentAt }, date
      });
      return true;
    }
    return applyInstallmentPayment(loan, current, installment, date);
  }

  function nextSimulationAutomationEvent() {
    const candidates = [];
    const addCandidate = (type, value, reference = null) => {
      const at = Date.parse(value);
      if (Number.isFinite(at)) candidates.push({ type, at, reference });
    };
    addCandidate('credit-request', db.simulationAutomation.nextCreditRequestAt);
    addCandidate('limit-increase-request', db.simulationAutomation.nextLimitIncreaseRequestAt);
    addCandidate('automatic-transfer', db.simulationAutomation.nextAutomaticTransferAt);
    addCandidate('automatic-withdrawal', db.simulationAutomation.nextAutomaticWithdrawalAt);
    addCandidate('treasury-distribution', db.simulationAutomation.nextTreasuryDistributionAt);
    (Array.isArray(db.limitIncreaseRequests) ? db.limitIncreaseRequests : []).forEach((request) => {
      if ((request.status || 'En revisión') === 'En revisión') {
        addCandidate('limit-increase-approval', request.autoApprovalAt, request);
      }
    });
    (Array.isArray(db.creditApplications) ? db.creditApplications : []).forEach((application) => {
      if (!automaticAdvanceIsScheduled(application)) return;
      if ((application.status || 'En revisión') === 'En revisión') {
        addCandidate('credit-approval', application.autoApprovalAt, application);
      } else if (application.status === 'Aprobado' && scheduledAdvanceAmountForApplication(application) > 0 && !application.autoAdvancedAt) {
        addCandidate('credit-advance', application.autoAdvanceAt, application);
      }
    });
    (Array.isArray(db.loans) ? db.loans : []).forEach((loan) => {
      if (loan?.status === 'Activo' && Number(loan.outstandingPrincipal) > 0) {
        addCandidate('installment', loan.nextAutomaticPaymentAt, loan);
      }
    });
    const priority = { 'treasury-distribution': 0, 'credit-request': 1, 'limit-increase-request': 2, 'limit-increase-approval': 3, 'credit-approval': 4, 'credit-advance': 5, installment: 6, 'automatic-transfer': 7, 'automatic-withdrawal': 8 };
    candidates.sort((left, right) => left.at - right.at || priority[left.type] - priority[right.type]);
    return candidates[0] || null;
  }

  function processSimulationAutomationEvents(now = Date.now()) {
    if (!db?.simulationAutomation || databaseLoadIssue || simulationAutomationProcessing) return { changed: false, eventsChanged: false, count: 0 };
    if (db.simulationAutomation.paused) return { changed: false, eventsChanged: false, count: 0, caughtUp: true, paused: true };
    simulationAutomationProcessing = true;
    let changed = false;
    let count = 0;
    try {
      while (count < SIMULATION_AUTOMATION_EVENT_LIMIT) {
        const event = nextSimulationAutomationEvent();
        if (!event || event.at > now) break;
        accrueWithdrawalTreasury(db, event.at);
        if (event.type === 'credit-request') {
          db.simulationAutomation.nextCreditRequestAt = new Date(event.at + simulationSettingsFor(db).creditRequestIntervalSeconds * 1000).toISOString();
          generateAutomaticCreditRequests(event.at);
        } else if (event.type === 'limit-increase-request') {
          db.simulationAutomation.nextLimitIncreaseRequestAt = new Date(event.at + simulationSettingsFor(db).limitIncreaseRequestIntervalSeconds * 1000).toISOString();
          generateAutomaticLimitIncreaseRequests(event.at);
        } else if (event.type === 'limit-increase-approval') {
          approveAutomaticLimitIncreaseRequest(event.reference, event.at);
        } else if (event.type === 'treasury-distribution') {
          db.simulationAutomation.nextTreasuryDistributionAt = new Date(event.at + simulationSettingsFor(db).treasuryDistributionIntervalSeconds * 1000).toISOString();
          distributeTreasuryEqually(event.at);
        } else if (event.type === 'automatic-transfer') {
          db.simulationAutomation.nextAutomaticTransferAt = new Date(event.at + simulationSettingsFor(db).automaticTransferIntervalSeconds * 1000).toISOString();
          executeAutomaticTransfer(event.at);
        } else if (event.type === 'automatic-withdrawal') {
          db.simulationAutomation.nextAutomaticWithdrawalAt = new Date(event.at + simulationSettingsFor(db).automaticWithdrawalIntervalSeconds * 1000).toISOString();
          executeAutomaticWithdrawal(event.at);
        } else if (event.type === 'credit-approval') {
          approveAutomaticCreditAndDisburse(event.reference, event.at);
        } else if (event.type === 'credit-advance') {
          advanceApprovedAutomaticCredit(event.reference, event.at);
        } else if (event.type === 'installment') {
          processAutomaticInstallment(event.reference, event.at);
        }
        changed = true;
        count += 1;
        if (count % 250 === 0 && typeof compactDatabaseForStorage === 'function') compactDatabaseForStorage(db);
      }
      const upcoming = nextSimulationAutomationEvent();
      const caughtUp = !upcoming || upcoming.at > now;
      const treasuryAdvanced = caughtUp ? accrueWithdrawalTreasury(db, now) : false;
      return { changed: changed || treasuryAdvanced, eventsChanged: changed, count, caughtUp };
    } finally {
      simulationAutomationProcessing = false;
    }
  }

  function catchUpAutomaticEventsBeforeOperation(now = Date.now()) {
    const result = processSimulationAutomationEvents(now);
    if (result.caughtUp === false) {
      showToast('Se están recuperando operaciones automáticas anteriores. Espera un momento e inténtalo de nuevo.', 'error');
      return false;
    }
    if (result.eventsChanged && readCurrentStorageRaw() === lastPersistedRaw && !saveDatabase()) return false;
    return true;
  }
  function persistAndRefreshSimulationAutomation(now = Date.now()) {
    const result = processSimulationAutomationEvents(now);
    const shouldSave = result.eventsChanged || !simulationAutomationInitialSaveDone || now - simulationAutomationLastSavedAt >= SIMULATION_AUTOMATION_SAVE_MS;
    if (!shouldSave || readCurrentStorageRaw() !== lastPersistedRaw) return result;
    if (saveDatabase()) {
      simulationAutomationInitialSaveDone = true;
      simulationAutomationLastSavedAt = Date.now();
      if (result.eventsChanged && typeof refreshRealtimeVisibleViews === 'function') {
        refreshRealtimeVisibleViews({ notify: false, reason: 'automatizacion' });
      }
    }
    return result;
  }

  function runSimulationAutomationTick() {
    persistAndRefreshSimulationAutomation(Date.now());
  }

  function simulationAutomationNeedsInitialSave() {
    if (databaseLoadIssue || lastPersistedRaw === null) return true;
    try {
      const saved = JSON.parse(lastPersistedRaw);
      if (!saved?.simulationAutomation || !saved.simulationAutomation.nextLimitIncreaseRequestAt
        || !saved.simulationAutomation.nextAutomaticTransferAt || !saved.simulationAutomation.nextAutomaticWithdrawalAt) return true;
      if (saved.simulationSettings?.automationSafetyPresetVersion !== db.simulationSettings?.automationSafetyPresetVersion
        || saved.simulationAutomation?.automationSafetyPresetVersion !== db.simulationAutomation?.automationSafetyPresetVersion) return true;
      for (const loan of (Array.isArray(db?.loans) ? db.loans : [])) {
        if (loan.status !== 'Activo' || Number(loan.outstandingPrincipal) <= 0) continue;
        const prior = (Array.isArray(saved.loans) ? saved.loans : []).find((item) => item.id === loan.id);
        if (!prior?.nextAutomaticPaymentAt || !Number.isSafeInteger(prior.automaticPaymentIntervalSeconds) || prior.automaticPaymentIntervalSeconds < 1) return true;
      }
      for (const request of (Array.isArray(db?.limitIncreaseRequests) ? db.limitIncreaseRequests : [])) {
        if ((request.status || 'En revisión') !== 'En revisión') continue;
        const prior = (Array.isArray(saved.limitIncreaseRequests) ? saved.limitIncreaseRequests : []).find((item) => item.id === request.id);
        if (!prior?.autoApprovalAt) return true;
      }      for (const application of (Array.isArray(db?.creditApplications) ? db.creditApplications : [])) {
        if (!automaticAdvanceIsScheduled(application)) continue;
        const prior = (Array.isArray(saved.creditApplications) ? saved.creditApplications : []).find((item) => item.id === application.id);
        if ((application.status || 'En revisión') === 'En revisión' && !prior?.autoApprovalAt) return true;
        if (application.status === 'Aprobado' && scheduledAdvanceAmountForApplication(application) > 0 && !application.autoAdvancedAt && !prior?.autoAdvanceAt) return true;
      }
      return false;
    } catch (error) {
      return true;
    }
  }
  function rescheduleSimulationAutomationAfterPause(now = Date.now()) {
    const settings = simulationSettingsFor(db);
    db.simulationAutomation.nextCreditRequestAt = new Date(now + settings.creditRequestIntervalSeconds * 1000).toISOString();
    db.simulationAutomation.nextLimitIncreaseRequestAt = new Date(now + settings.limitIncreaseRequestIntervalSeconds * 1000).toISOString();
    db.simulationAutomation.nextAutomaticTransferAt = new Date(now + settings.automaticTransferIntervalSeconds * 1000).toISOString();
    db.simulationAutomation.nextAutomaticWithdrawalAt = new Date(now + settings.automaticWithdrawalIntervalSeconds * 1000).toISOString();
    db.simulationAutomation.nextTreasuryDistributionAt = new Date(now + settings.treasuryDistributionIntervalSeconds * 1000).toISOString();
    (Array.isArray(db.limitIncreaseRequests) ? db.limitIncreaseRequests : []).forEach((request) => {
      if ((request.status || 'En revisión') !== 'En revisión') return;
      request.autoApprovalAt = new Date(now + settings.automaticLimitIncreaseApprovalDelaySeconds * 1000).toISOString();
    });
    (Array.isArray(db.creditApplications) ? db.creditApplications : []).forEach((application) => {
      if (application.automaticSimulation === true && (application.status || 'En revisión') === 'En revisión') {
        application.autoApprovalAt = new Date(now + settings.automaticCreditApprovalDelaySeconds * 1000).toISOString();
      } else if (application.status === 'Aprobado' && scheduledAdvanceAmountForApplication(application) > 0 && !application.autoAdvancedAt) {
        application.autoAdvanceEnabled = true;
        application.autoAdvanceAt = new Date(now + settings.automaticAdvanceDelaySeconds * 1000).toISOString();
      }
    });
    (Array.isArray(db.loans) ? db.loans : []).forEach((loan) => {
      if (loan?.status !== 'Activo' || Number(loan.outstandingPrincipal) <= 0) return;
      loan.automaticPaymentIntervalSeconds = automaticPaymentIntervalForTerm(loan.termMonths, db, loan.paymentScheduleType);
      loan.nextAutomaticPaymentAt = new Date(now + loan.automaticPaymentIntervalSeconds * 1000).toISOString();
    });
    if (db.withdrawalTreasury) db.withdrawalTreasury.lastAccruedAt = new Date(now).toISOString();
  }

  function toggleSimulationAutomationPause() {
    if (!reviewerSession || !db?.simulationAutomation) return;
    const wasPaused = db.simulationAutomation.paused === true;
    if (!wasPaused && !catchUpAutomaticEventsBeforeOperation()) return;
    const now = Date.now();
    db.simulationAutomation.paused = !wasPaused;
    db.simulationAutomation.pausedAt = wasPaused ? null : new Date(now).toISOString();
    if (wasPaused) rescheduleSimulationAutomationAfterPause(now);
    recordAuditEvent(wasPaused ? 'Automatización reanudada' : 'Automatización pausada', {
      category: 'sistema',
      source: 'Analista',
      description: wasPaused
        ? 'Se reanudó la automatización y se programaron nuevos intervalos desde este momento.'
        : 'Se pausaron las solicitudes, aprobaciones, cuotas, repartos y el cronómetro de Tesorería.',
      date: new Date(now).toISOString()
    });
    if (!saveDatabase()) {
      if (typeof renderSimulationSettingsPanel === 'function') renderSimulationSettingsPanel();
      return;
    }
    if (typeof renderSimulationSettingsPanel === 'function') renderSimulationSettingsPanel();
    showToast(wasPaused ? 'Automatización reanudada.' : 'Automatización pausada.');
  }

  function startSimulationAutomation() {
    if (simulationAutomationTimerId !== null) return;
    simulationAutomationInitialSaveDone = !simulationAutomationNeedsInitialSave();
    runSimulationAutomationTick();
    simulationAutomationTimerId = window.setInterval(runSimulationAutomationTick, SIMULATION_AUTOMATION_TICK_MS);
  }

  function catchUpSimulationAutomationOnResume() {
    persistAndRefreshSimulationAutomation(Date.now());
  }

  $('#toggleSimulationAutomationButton')?.addEventListener('click', toggleSimulationAutomationPause);

  window.addEventListener('focus', catchUpSimulationAutomationOnResume);
  window.addEventListener('pageshow', catchUpSimulationAutomationOnResume);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') catchUpSimulationAutomationOnResume();
  });
