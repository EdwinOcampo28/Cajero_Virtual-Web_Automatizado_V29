  async function submitCardAdvance(event) {
    event.preventDefault();
    if (typeof catchUpAutomaticEventsBeforeOperation === 'function' && !catchUpAutomaticEventsBeforeOperation()) return;
    const current = account();
    if (!current) return;
    const rawAmount = Number($('#cardFundsAmount').value);
    const amount = roundMoney(rawAmount);
    const selectedTerm = Number(advanceTermSelect?.value || 12);
    clearCardFormError('cardFunds');
    if (!validIntegerAmount(rawAmount)) return cardFormProblem('cardFunds', 'Ingresa un importe entero mayor que cero, sin decimales.');
    if (!VALID_CARD_ADVANCE_TERMS.includes(selectedTerm)) return cardFormProblem('cardFunds', 'Para los avances, selecciona un plazo entre 6 y 60 cuotas, en intervalos de 6.');
    const card = current.card;
    const totalAvailable = availableAdvancesForCard(card);
    if (amount > totalAvailable) return cardFormProblem('cardFunds', `No hay suficientes fondos disponibles para avanzar. Disponible: ${money(totalAvailable)}.`);
    const fromOriginalFunds = Math.min(amount, Math.max(0, Number(card.funds) || 0));
    const recycledPrincipalDraw = roundMoney(amount - fromOriginalFunds);
    const pendingFundsToActivate = Math.min(fromOriginalFunds, pendingCardDisbursementTotalForAccount(activeAccountId));
    const activationTerm = pendingFundsToActivate > 0 ? cardAdvanceTermForAmount(activeAccountId, pendingFundsToActivate, selectedTerm) : selectedTerm;
    if (current.balance + amount < ADVANCE_FEE) return cardFormProblem('cardFunds', `El costo del avance es ${money(ADVANCE_FEE)}. Necesitas contar con ese importe entre tus ahorros y el dinero que vas a avanzar.`);
    const resultingBalance = roundMoney(current.balance + amount - ADVANCE_FEE);
    if (resultingBalance > maxSavingsBalanceForAccount(current.id)) return cardFormProblem('cardFunds', 'El saldo excede el rango numérico exacto que admite el simulador.');
    if (recycledPrincipalDraw > 0) {
      if (recycledPrincipalDraw > availableAnalystCapital()) return cardFormProblem('cardFunds', `El fondo de crédito no tiene suficiente capital para añadir este avance a la deuda. Disponible del analista: ${money(availableAnalystCapital())}.`);
      if (recycledPrincipalDraw > availablePersonalCreditForAccount(activeAccountId)) return cardFormProblem('cardFunds', `Este avance supera el máximo de capital pendiente de tu cuenta. Disponible: ${money(availablePersonalCreditForAccount(activeAccountId))}.`);
    }
    const transactionRevision = captureDatabaseRevision();
    const confirmMessage = `¿Confirmas realizar un avance de ${money(amount)} a tus ahorros? El dinero proviene del saldo disponible asociado a desembolsos ya realizados.${pendingFundsToActivate > 0 ? `\n\nSe activará un crédito únicamente por ${money(pendingFundsToActivate)} de los fondos desembolsados que vas a trasladar. Los ${money(Math.max(0, fromOriginalFunds - pendingFundsToActivate))} restantes corresponden a fondos anteriores sin crédito asociado.` : ''}

Costo por realizar el avance: ${money(ADVANCE_FEE)}. Este costo se descontará de tus ahorros.${pendingFundsToActivate > 0 || recycledPrincipalDraw > 0 ? `\nPlazo del crédito después del avance: ${activationTerm} cuotas al ${formatMonthlyInterestRate()} mensual.` : ''}`;
    const confirmed = await showAppDialog({
      type: 'confirm', title: 'Realizar avance a tus ahorros',
      message: confirmMessage,
      eyebrow: 'AVANCE A CUENTA PROPIA', icon: '↗', confirmText: 'Confirmar avance'
    });
    if (!confirmed) return;
    if (!isDatabaseRevisionCurrent(transactionRevision)) { abortStaleFinancialOperation(); return; }
    const activation = activatePendingCardDisbursements(activeAccountId, fromOriginalFunds, selectedTerm);
    if (!activation.ok) return cardFormProblem('cardFunds', activation.error || 'No se pudieron validar los fondos desembolsados en la tarjeta. No se realizó el avance.');
    card.funds = roundMoney(Math.max(0, (Number(card.funds) || 0) - fromOriginalFunds));
    card.recoveredFunds = roundMoney(Math.max(0, (Number(card.recoveredFunds) || 0) - recycledPrincipalDraw));
    current.balance = resultingBalance;
    if (recycledPrincipalDraw > 0) {
      const includesLimitIncrease = activation.activations.some((item) => item.origin === 'Aumento de cupo');
      const effectiveTerm = includesLimitIncrease ? 12 : selectedTerm;
      const unifiedLoan = addRecoveredCapitalToUnifiedDebt(activeAccountId, recycledPrincipalDraw, effectiveTerm);
      if (unifiedLoan) {
        recordCardMovement(activeAccountId, 'card_reborrow', recycledPrincipalDraw, `Capital recuperado añadido a la deuda única · Cuota mensual actual ${money(unifiedLoan.monthlyPayment)}`, 'out');
        recordMovement(activeAccountId, 'card_reborrow', recycledPrincipalDraw, `Capital recuperado añadido a la deuda única · Nueva cuota mensual ${money(unifiedLoan.monthlyPayment)}`, null);
      }
    }
    db.advanceFeesCollected = roundMoney((Number(db.advanceFeesCollected) || 0) + ADVANCE_FEE);
    recordCardMovement(activeAccountId, 'card_advance', amount, 'Avance de tarjeta recibido en mis ahorros', 'out');
    recordMovement(activeAccountId, 'card_advance', amount, 'Avance de tarjeta recibido en mis ahorros', 'in');
    recordCardMovement(activeAccountId, 'card_advance_fee', ADVANCE_FEE, 'Costo de realizar avance', 'out');
    recordMovement(activeAccountId, 'card_advance_fee', ADVANCE_FEE, 'Costo por realizar avance', 'out');
    if (!saveDatabase()) { renderApp(); return; }
    $('#cardFundsForm').reset();
    renderApp();
    renderLoans();
    renderCreditApplications();
    if (reviewerSession) renderReviewerDashboard();
    const netAdded = roundMoney(amount - ADVANCE_FEE);
    const activeUnifiedDebt = (db.loans || []).find((loan) => loan.accountId === activeAccountId && loan.status === 'Activo' && loan.outstandingPrincipal > 0);
    const activated = activation.activatedAmount;
    showToast(`Avance realizado. ${money(netAdded)} netos llegaron a tus ahorros tras cobrar ${money(ADVANCE_FEE)}.${activated > 0 && activeUnifiedDebt ? ` Se activó crédito por ${money(activated)} al trasladar esos fondos; la cuota mensual unificada es ${money(activeUnifiedDebt.monthlyPayment)}.` : recycledPrincipalDraw > 0 && activeUnifiedDebt ? ` Se usaron fondos recuperados y la cuota mensual unificada es ${money(activeUnifiedDebt.monthlyPayment)}.` : ' Este avance no activa crédito nuevo porque trasladó fondos anteriores sin registro pendiente.'}`);
  }
