#!/usr/bin/env node
// Regression test: disbursements stay as card funds until a client makes an advance.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

let nextId = 1;
const db = {
  accounts: [null,
    { id: 1, name: 'Cliente de prueba', accountNumber: '1000 0000 0001', cardNumber: '4111111111111111', balance: 0, card: { limit: 100000000, funds: 0, recoveredFunds: 0, debt: 0, history: [], pendingDisbursements: [] } },
    { id: 2, name: 'Cliente de cupo', accountNumber: '1000 0000 0002', cardNumber: '4111111111111112', balance: 0, card: { limit: 100000000, funds: 0, recoveredFunds: 0, debt: 0, history: [], pendingDisbursements: [] } },
    { id: 3, name: 'Cliente tres', accountNumber: '1000 0000 0003', balance: 0, card: { limit: 100000000, funds: 0, recoveredFunds: 0, debt: 0, history: [], pendingDisbursements: [] } }
  ],
  creditApplications: [{ id: 'credit-1', accountId: 1, amount: 25000000, termMonths: 12, monthlyPayment: 2300000, totalPayable: 27600000, status: 'En revisión', date: '2026-10-22T10:00:00.000Z' }],
  limitIncreaseRequests: [{ id: 'limit-1', accountId: 2, applicantName: 'Cliente de cupo', previousLimit: 100000000, requestedLimit: 150000000, increaseAmount: 50000000, termMonths: 12, status: 'En revisión', date: '2026-10-22T10:00:00.000Z' }],
  loans: [],
  auditLog: [],
  advanceFeesCollected: 0,
  operationFeesCollected: 0
};
const context = {
  db,
  reviewerSession: true,
  simulationSettingsFor: (database) => ({ analystCapital: 500000000, automaticAdvanceDelaySeconds: 1, ...(database.simulationSettings || {}) }),
  MAX_CARD_FUNDS: 100000000,
  MAX_CARD_LIMIT: 500000000,
  ANALYST_TOTAL_CAPITAL: 500000000,
  ILLUSTRATIVE_MONTHLY_RATE: 0.02, currentMonthlyInterestRate: () => 0.02,
  VALID_CREDIT_TERMS: [6, 12, 18, 24, 30, 36, 42, 48, 54, 60],
  VALID_CARD_ADVANCE_TERMS: [6, 12, 18, 24, 30, 36, 42, 48, 54, 60],
  REVIEWER_NAME: 'Analista',
  roundMoney: (amount) => Math.round(Number(amount) || 0),
  createId: () => `generated-${nextId++}`,
  calculateCreditEstimate: (amount, termMonths) => ({ monthlyPayment: Math.round(amount / termMonths), totalPayable: amount, totalInterest: 0 }),
  createLoanFromApplication(application) {
    const disbursedAt = application.lastAdvancedAt || application.disbursedAt || new Date().toISOString();
    const automaticPaymentIntervalSeconds = application.termMonths === 6 ? 300 : 180;
    return {
      id: `loan-${nextId++}`,
      applicationId: application.id,
      applicationIds: [application.id],
      accountId: application.accountId,
      principalOriginal: application.amount,
      originalDisbursedTotal: application.amount,
      reborrowedCapitalTotal: 0,
      outstandingPrincipal: application.amount,
      monthlyRate: 0.02,
      termMonths: application.termMonths,
      monthlyPayment: application.monthlyPayment,
      automaticPaymentIntervalSeconds,
      nextAutomaticPaymentAt: new Date(Date.parse(disbursedAt) + automaticPaymentIntervalSeconds * 1000).toISOString(),
      installmentsPaid: 0,
      status: 'Activo',
      source: 'Crédito unificado',
      payments: []
    };
  },
  estimateRemainingInstallments: (loan) => Math.max(1, Number(loan.termMonths) || 12),
  recalculateUnifiedLoanSchedule(loan, termMonths) { loan.termMonths = termMonths; },
  captureDatabaseRevision: () => 1,
  isDatabaseRevisionCurrent: () => true,
  abortStaleFinancialOperation() { throw new Error('Unexpected stale revision'); },
  showAppDialog: async ({ type }) => type === 'prompt' ? 'Prueba' : true,
  saveDatabase: () => true,
  recordCardMovement() {},
  recordMovement() {},
  recordAuditEvent() {},
  renderReviewerDashboard() {},
  showToast() {},
  money: (amount) => `$ ${Math.round(Number(amount) || 0)}`
};
vm.createContext(context);
for (const file of ['03-credit-engine-03.js', '03-credit-engine-04.js', '06-analyst-decisions-02.js', '06-analyst-decisions-03.js']) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', file), 'utf8');
  vm.runInContext(source, context, { filename: file });
}

(async () => {
  await context.registerCreditDecision('credit-1', 'Aprobado');
  const personalApplication = db.creditApplications.find((item) => item.id === 'credit-1');
  assert(db.loans.length === 0, 'El desembolso personal no debe crear un préstamo antes de un avance.');
  assert(db.accounts[1].card.funds === 25000000, 'El desembolso personal debe cargar fondos a la tarjeta.');
  assert(db.accounts[1].card.pendingDisbursements[0].remainingAmount === 25000000, 'El saldo pendiente debe registrarse en la tarjeta.');
  assert(personalApplication.status === 'Aprobado' && personalApplication.cardFundsRemaining === 25000000, 'La solicitud debe indicar fondos cargados sin crédito activo.');
  assert(context.availableAnalystCapital() === 475000000, 'El capital en tarjeta debe quedar comprometido para el analista.');

  personalApplication.disbursedAt = '2026-10-22T10:00:00.000Z';
  const firstAdvanceAt = '2026-10-22T10:10:00.000Z';
  let activation = context.activatePendingCardDisbursements(1, 5000000, 60, firstAdvanceAt);
  assert(activation.ok && activation.activatedAmount === 5000000, 'El primer avance debe activar solo el importe trasladado.');
  db.accounts[1].card.funds -= 5000000;
  assert(db.loans.length === 1 && db.loans[0].outstandingPrincipal === 5000000, 'El primer avance debe crear crédito por su importe exacto.');
  assert(db.loans[0].termMonths === 60, 'Los avances deben aceptar plazos de hasta 60 cuotas.' );
  assert(db.loans[0].nextAutomaticPaymentAt === '2026-10-22T10:13:00.000Z', 'La primera cuota debe programarse desde el momento real del avance, no desde el desembolso anterior a la espera automática.');
  assert(personalApplication.cardFundsRemaining === 20000000 && personalApplication.status === 'Aprobado', 'El saldo restante debe permanecer en tarjeta sin cuotas.');

  activation = context.activatePendingCardDisbursements(1, 1000000, 6);
  db.accounts[1].card.funds -= 1000000;
  assert(activation.ok && db.loans[0].outstandingPrincipal === 6000000, 'El segundo avance debe integrarse a la deuda activa.');
  assert(db.loans[0].termMonths === 6, 'Al elegir seis cuotas, el avance debe reemplazar el plazo anterior de doce.');
  assert(personalApplication.cardFundsRemaining === 19000000, 'El segundo avance debe descontarse solo de los fondos pendientes.');
  assert(context.cardAdvanceTermForAmount(1, 1000000, 6) === 6, 'La confirmación debe mostrar seis cuotas para fondos de un crédito personal.');

  await context.registerLimitIncreaseDecision('limit-1', 'Aprobado');
  const increaseApplication = db.creditApplications.find((item) => item.origin === 'Aumento de cupo');
  assert(db.loans.length === 1, 'Aprobar el aumento de cupo tampoco debe crear un préstamo antes de un avance.');
  assert(db.accounts[2].card.limit === 150000000 && db.accounts[2].card.funds === 50000000, 'El aumento aprobado debe elevar el cupo y cargar $50.000.000 a la tarjeta.');
  assert(increaseApplication.cardFundsRemaining === 50000000, 'Los fondos del aumento deben quedar pendientes en tarjeta.');
  assert(context.cardAdvanceTermForAmount(2, 15000000, 6) === 12, 'La confirmación debe avisar que los fondos del aumento conservan doce cuotas.');

  activation = context.activatePendingCardDisbursements(2, 15000000, 60);
  db.accounts[2].card.funds -= 15000000;
  assert(activation.ok && activation.activatedAmount === 15000000, 'Un avance parcial del aumento debe activar solo la parte trasladada.');
  const limitLoan = db.loans.find((loan) => loan.accountId === 2);
  assert(limitLoan && limitLoan.outstandingPrincipal === 15000000, 'El préstamo del aumento debe corresponder al avance parcial.');
  assert(limitLoan.termMonths === 12, 'Los avances del aumento de cupo deben conservar el plazo fijo de 12 meses.');
  assert(increaseApplication.cardFundsRemaining === 35000000, 'El resto del aumento debe seguir en tarjeta.');
  assert(context.availableAnalystCapital() === 425000000, 'El capital comprometido debe sumar créditos activos y fondos aún en tarjeta.');

  console.log('PASS: los desembolsos personales y los aumentos solo crean crédito cuando se avanza.');
  console.log('PASS: los fondos pendientes siguen en tarjeta y restan del capital disponible.');
  console.log('PASS: los avances personales permiten hasta 60 cuotas y los aumentos de cupo conservan 12 meses.');
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
