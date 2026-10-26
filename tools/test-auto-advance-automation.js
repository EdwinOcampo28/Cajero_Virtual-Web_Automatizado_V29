#!/usr/bin/env node
// Regression: automatic advances run from approval timestamps and use advance-only payment intervals.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function assert(condition, message) { if (!condition) throw new Error(message); }
function localDateKey(value = new Date()) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
const eventAt = Date.parse('2026-10-25T10:00:00.000Z');
const eventDate = new Date(eventAt).toISOString();
const account = {
  id: 1, name: 'Cliente automático', accountNumber: '1000 0000 0001', balance: 0,
  card: { limit: 100000000, funds: 2000000, recoveredFunds: 0, debt: 0, history: [], pendingDisbursements: [
    { applicationId: 'automatic-advance-1', remainingAmount: 2000000, origin: 'Crédito', termMonths: 6, createdAt: new Date(eventAt - 30000).toISOString() }
  ] }
};
const application = {
  id: 'automatic-advance-1', accountId: 1, applicantName: account.name, accountNumber: account.accountNumber,
  amount: 2000000, termMonths: 6, monthlyRate: 0.02, monthlyPayment: 357000, totalPayable: 2142000,
  status: 'Aprobado', origin: 'Crédito', automaticSimulation: false, cardFundsRemaining: 0,
  // La fecha y la cola de la tarjeta deben bastar para recuperar aplicaciones aprobadas antiguas.
  autoAdvanceAt: eventDate,
  disbursedAt: new Date(eventAt - 30000).toISOString(), cardFundsRemaining: 2000000, activatedAmount: 0
};
const future = new Date(eventAt + 3600000).toISOString();
const db = {
  accounts: [null, account], creditApplications: [application], limitIncreaseRequests: [], loans: [], auditLog: [],
  simulationAutomation: {
    paused: false, nextCreditRequestAt: future, nextLimitIncreaseRequestAt: future,
    nextTreasuryDistributionAt: future, nextAutomaticTransferAt: future, nextAutomaticWithdrawalAt: future
  },
  simulationSettings: {
    analystCapital: 2000000000, monthlyInterestRate: 0.02, automaticAdvanceDelaySeconds: 30,
    automaticAdvanceMaximumAmount: 100000000, automaticAdvanceMinimumAmount: 100000,
    automaticAdvanceMode: 'credit_amount', automaticCreditMinimumAmount: 100000, automaticCreditMaximumAmount: 100000000,
    paymentInterval6Seconds: 300, paymentInterval12Seconds: 180,
    advancePaymentInterval6Seconds: 42, advancePaymentInterval12Seconds: 84
  },
  withdrawalTreasury: { balance: 0, lastAccruedAt: eventDate, history: [] }, advanceFeesCollected: 0, operationFeesCollected: 0
};
let nextId = 1;
const context = {
  db, document: { visibilityState: 'hidden', addEventListener() {} }, window: { addEventListener() {}, setInterval() { return 1; } },
  $: () => null, databaseLoadIssue: false, reviewerSession: false,
  ILLUSTRATIVE_MONTHLY_RATE: 0.02, ANALYST_TOTAL_CAPITAL: 2000000000, DEFAULT_LIMIT_INCREASE_AMOUNT: 50000000,
  TREASURY_TIMER_RATE: 1000, TREASURY_TIMER_INCOME_CAP: Number.MAX_SAFE_INTEGER,
  SIMULATION_HOUR_MS: 3600000, SIMULATION_APPROVAL_DELAY_MS: 60000, AUTOMATIC_PAYMENT_INTERVAL_MS: { 6: 300, 12: 180 },
  MIN_CREDIT_AMOUNT: 100000, MAX_CREDIT_AMOUNT: 100000000, MAX_CARD_FUNDS: 100000000, MAX_CARD_LIMIT: Number.MAX_SAFE_INTEGER,
  ADVANCE_FEE: 100000, VALID_CREDIT_TERMS: [6, 12, 18, 24, 30, 36, 42, 48, 54, 60], VALID_CARD_ADVANCE_TERMS: [6, 12, 18, 24, 30, 36, 42, 48, 54, 60], MAX_ACCOUNT_ID: 1,
  localDateKey, maxSavingsBalanceForAccount: () => Number.MAX_SAFE_INTEGER,
  roundMoney: (amount) => Math.round(Number(amount) || 0), createId: () => `loan-${nextId++}`,
  recordAuditEvent() {}, recordCardMovement() {}, recordMovement() {}, accrueWithdrawalTreasury() { return false; },
  money: (amount) => `$ ${Math.round(Number(amount) || 0)}`, showToast() {}
};
vm.createContext(context);
for (const file of [
  '01-storage-and-migrations-03.js', '03-credit-engine-01.js', '03-credit-engine-02.js',
  '03-credit-engine-03.js', '03-credit-engine-04.js', '23c-simulation-automation.js'
]) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', file), 'utf8');
  vm.runInContext(source, context, { filename: file });
}
assert(context.automaticPaymentIntervalForTerm(6, db, 'credit') === 300, 'El intervalo general de créditos a 6 cuotas debe conservarse.');
assert(context.automaticPaymentIntervalForTerm(6, db, 'advance') === 42, 'El intervalo configurado para avances debe ser independiente.');
const result = context.processSimulationAutomationEvents(eventAt);
assert(result.eventsChanged && result.count === 1, 'El planificador debe ejecutar el avance automático vencido.');
assert(application.autoAdvancedAt === eventDate && application.cardFundsRemaining === 0, 'El avance debe marcarse como realizado y liquidar los fondos pendientes.');
assert(account.card.funds === 0 && account.balance === 1900000, 'Los fondos deben salir de la tarjeta y llegar a ahorros menos la comisión.');
assert(db.loans.length === 1 && db.loans[0].paymentScheduleType === 'advance', 'La deuda creada debe quedar identificada como originada por un avance.');
assert(db.loans[0].automaticPaymentIntervalSeconds === 42, 'La deuda del avance debe usar su intervalo exclusivo.');
assert(db.loans[0].nextAutomaticPaymentAt === new Date(eventAt + 42000).toISOString(), 'La primera cuota del avance debe empezar desde el momento del avance.');
const partialApplication = {
  id: 'automatic-partial-2', accountId: 1, applicantName: account.name, accountNumber: account.accountNumber,
  amount: 1000000, termMonths: 6, monthlyRate: 0.02, monthlyPayment: 180000, totalPayable: 1080000,
  status: 'Aprobado', origin: 'Crédito', autoAdvanceEnabled: true, autoAdvanceAt: new Date(eventAt + 60000).toISOString(),
  cardFundsRemaining: 1000000, activatedAmount: 0
};
db.creditApplications.push(partialApplication);
account.card.funds += 1000000;
account.card.pendingDisbursements.push({ applicationId: partialApplication.id, remainingAmount: 1000000, origin: 'Crédito', termMonths: 6 });
db.simulationSettings.automaticAdvanceMode = 'range';
db.simulationSettings.automaticAdvanceMinimumAmount = 100000;
db.simulationSettings.automaticAdvanceMaximumAmount = 1000000;
context.Math = Object.create(Math);
context.Math.random = () => 0;
assert(context.advanceApprovedAutomaticCredit(partialApplication, eventAt + 60000), 'El modo aleatorio debe completar el primer avance parcial.');
assert(partialApplication.activatedAmount === 100000 && partialApplication.cardFundsRemaining === 900000, 'El avance parcial debe conservar el saldo pendiente en la tarjeta.');
assert(partialApplication.autoAdvancedAt === null && Date.parse(partialApplication.autoAdvanceAt) === eventAt + 90000, 'El saldo restante debe quedar programado para el siguiente avance automático.');
console.log('PASS: los avances parciales se registran por separado y el saldo restante sigue programado automáticamente.');
console.log('PASS: el planificador avanza un crédito aprobado sin depender de un aumento de cupo.');
console.log('PASS: las cuotas de avances usan un intervalo distinto del intervalo general de créditos.');
