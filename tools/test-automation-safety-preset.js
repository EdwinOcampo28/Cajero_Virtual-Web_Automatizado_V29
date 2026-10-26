#!/usr/bin/env node
// Regression: upgrade applies an automatic cadence once, preserves pending work, and resumes it.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function assert(condition, message) { if (!condition) throw new Error(message); }
const now = Date.parse('2026-10-25T10:00:00.000Z');
const oldDate = new Date(now + 86400000).toISOString();
const db = {
  simulationSettings: {
    analystCapital: 2000000000, limitIncreaseAmount: 50000000, monthlyInterestRate: 0.02,
    treasuryTimerRate: 1000, treasuryTimerIncomeCap: Number.MAX_SAFE_INTEGER,
    creditRequestIntervalSeconds: 60, automaticCreditApprovalDelaySeconds: 5, automaticAdvanceDelaySeconds: 1,
    limitIncreaseRequestIntervalSeconds: 3600, automaticLimitIncreaseApprovalDelaySeconds: 5,
    automaticTransferIntervalSeconds: 60, automaticWithdrawalIntervalSeconds: 60,
    treasuryDistributionIntervalSeconds: 60, paymentInterval6Seconds: 60, paymentInterval12Seconds: 60,
    automaticCreditMinimumAmount: 100000, automaticCreditMaximumAmount: 100000000,
    automaticAdvanceMinimumAmount: 100000, automaticAdvanceMaximumAmount: 100000000,
    automaticAdvanceMode: 'credit_amount', automaticCreditTermMonths: 0
  },
  simulationAutomation: { paused: true, pausedAt: oldDate, nextCreditRequestAt: oldDate, nextLimitIncreaseRequestAt: oldDate, nextTreasuryDistributionAt: oldDate, nextAutomaticTransferAt: oldDate, nextAutomaticWithdrawalAt: oldDate },
  accounts: [null, { id: 1, balance: 0, card: { funds: 10000000, pendingDisbursements: [{ applicationId: 'old-approved', remainingAmount: 10000000 }] } }],
  creditApplications: [
    { id: 'old-approved', accountId: 1, amount: 10000000, status: 'Aprobado', cardFundsRemaining: 10000000, autoAdvanceAt: oldDate },
    { id: 'old-request', accountId: 1, amount: 5000000, automaticSimulation: true, status: 'En revisión', autoApprovalAt: oldDate }
  ],
  limitIncreaseRequests: [{ id: 'old-limit', accountId: 1, previousLimit: 100000000, requestedLimit: 150000000, increaseAmount: 50000000, status: 'En revisión', autoApprovalAt: oldDate }],
  loans: [{ id: 'old-loan', accountId: 1, status: 'Activo', outstandingPrincipal: 1000000, termMonths: 6, paymentScheduleType: 'advance', automaticPaymentIntervalSeconds: 60, nextAutomaticPaymentAt: oldDate }]
};
const context = {
  db, ILLUSTRATIVE_MONTHLY_RATE: 0.02, ANALYST_TOTAL_CAPITAL: 2000000000,
  DEFAULT_LIMIT_INCREASE_AMOUNT: 50000000, TREASURY_TIMER_RATE: 1000,
  TREASURY_TIMER_INCOME_CAP: Number.MAX_SAFE_INTEGER, SIMULATION_HOUR_MS: 3600000,
  SIMULATION_APPROVAL_DELAY_MS: 60000, AUTOMATIC_PAYMENT_INTERVAL_MS: { 6: 300000, 12: 180000 },
  MIN_CREDIT_AMOUNT: 100000, MAX_CREDIT_AMOUNT: 100000000,
  VALID_CREDIT_TERMS: [6,12,18,24,30,36,42,48,54,60], VALID_CARD_ADVANCE_TERMS: [6,12,18,24,30,36,42,48,54,60],
  roundMoney: (value) => Math.round(Number(value) || 0), addMonthsToDate: () => '2026-11-25'
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src/js/01-storage-and-migrations-03.js'), 'utf8'), context, { filename: '01-storage-and-migrations-03.js' });
assert(context.normalizeSimulationSettings(db), 'La configuración antigua debe migrarse.');
assert(context.normalizeSimulationAutomation(db, now), 'La automatización antigua debe migrarse.');
assert(db.simulationSettings.automationSafetyPresetVersion === 1, 'El preset debe persistir para no sobrescribir cambios posteriores.');
assert(db.simulationSettings.automaticAnalystCapitalReserve === 500000000, 'La reserva protegida debe quedar establecida en $500 millones.');
assert(db.simulationSettings.automaticAdvanceDelaySeconds === 30 && db.simulationSettings.limitIncreaseRequestIntervalSeconds === 86400, 'Los tiempos deben quedar en 30 s para avances y 24 h para nuevas solicitudes de cupo.');
assert(db.simulationAutomation.paused === false, 'La actualización debe dejar la automatización activa.');
assert(Date.parse(db.simulationAutomation.nextCreditRequestAt) === now + 3600000, 'El primer crédito debe programarse tras una hora.');
assert(Date.parse(db.simulationAutomation.nextLimitIncreaseRequestAt) === now + 86400000, 'El primer aumento automático debe programarse tras 24 horas.');
assert(Date.parse(db.creditApplications[0].autoAdvanceAt) === now + 30000, 'Los fondos aprobados en tarjeta deben recuperar un avance automático.');
assert(Date.parse(db.creditApplications[1].autoApprovalAt) === now + 60000, 'Las solicitudes antiguas deben adoptar el minuto de aprobación.');
assert(Date.parse(db.limitIncreaseRequests[0].autoApprovalAt) === now + 60000, 'Los aumentos pendientes deben adoptar el minuto de aprobación.');
assert(db.loans[0].automaticPaymentIntervalSeconds === 300, 'Las deudas por avance deben tomar su intervalo exclusivo de 5 minutos.');
assert(Date.parse(db.loans[0].nextAutomaticPaymentAt) === now + 300000, 'La próxima cuota debe reprogramarse desde la actualización.');
console.log('PASS: el perfil automático seguro se aplica una vez, reactiva el planificador y conserva las operaciones pendientes.');
