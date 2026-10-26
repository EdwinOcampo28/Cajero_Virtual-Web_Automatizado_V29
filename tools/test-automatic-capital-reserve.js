#!/usr/bin/env node
// Regression: automation preserves an analyst reserve and budgets pending increases.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function assert(condition, message) { if (!condition) throw new Error(message); }
const now = Date.parse('2026-10-25T10:00:00.000Z');
const db = {
  accounts: [null,
    { id: 1, name: 'Uno', accountNumber: '1000 0000 0001', balance: 0, card: { limit: 100000000, funds: 0, recoveredFunds: 0, pendingDisbursements: [] } },
    { id: 2, name: 'Dos', accountNumber: '1000 0000 0002', balance: 0, card: { limit: 100000000, funds: 0, recoveredFunds: 0, pendingDisbursements: [] } },
    { id: 3, name: 'Tres', accountNumber: '1000 0000 0003', balance: 0, card: { limit: 100000000, funds: 0, recoveredFunds: 0, pendingDisbursements: [] } }
  ],
  simulationSettings: { analystCapital: 2000000000, limitIncreaseAmount: 50000000, automaticAnalystCapitalReserve: 500000000 },
  simulationAutomation: { paused: false },
  creditApplications: [{ id: 'pending-credit', accountId: 1, amount: 100000000, automaticSimulation: true, status: 'En revisión' }],
  limitIncreaseRequests: [], auditLog: [], loans: []
};
let availableCapital = 1050000000;
let nextId = 1;
const context = {
  db, MAX_ACCOUNT_ID: 3, MAX_CARD_LIMIT: Number.MAX_SAFE_INTEGER, MIN_CREDIT_AMOUNT: 100000,
  ANALYST_TOTAL_CAPITAL: 2000000000, DEFAULT_LIMIT_INCREASE_AMOUNT: 50000000,
  ILLUSTRATIVE_MONTHLY_RATE: 0.02, SIMULATION_HOUR_MS: 3600000, SIMULATION_APPROVAL_DELAY_MS: 60000,
  AUTOMATIC_PAYMENT_INTERVAL_MS: { 6: 300000, 12: 180000 }, TREASURY_TIMER_RATE: 1000,
  TREASURY_TIMER_INCOME_CAP: Number.MAX_SAFE_INTEGER, MAX_CREDIT_AMOUNT: 100000000,
  VALID_CREDIT_TERMS: [6,12,18,24,30,36,42,48,54,60], VALID_CARD_ADVANCE_TERMS: [6,12,18,24,30,36,42,48,54,60],
  roundMoney: (value) => Math.round(Number(value) || 0), localDateKey: () => '2026-10-25',
  calculateCreditEstimate: () => ({ monthlyPayment: 1, totalPayable: 1, totalInterest: 0 }),
  availableAnalystCapital: () => availableCapital, cardCreditLimitForAccount: (id) => db.accounts[id].card.limit,
  recordAuditEvent() {}, createId: () => `request-${nextId++}`, money: (value) => String(value),
  simulationSettingsFor: (database = db) => ({ ...context.freshDefaults, ...(database.simulationSettings || {}) }),
  freshDefaults: null, $: () => null, window: { addEventListener() {} }, document: { addEventListener() {} }
};
context.freshDefaults = {
  monthlyInterestRate: 0.02, analystCapital: 2000000000, limitIncreaseAmount: 50000000,
  treasuryTimerRate: 1000, treasuryTimerIncomeCap: Number.MAX_SAFE_INTEGER,
  creditRequestIntervalSeconds: 3600, automaticCreditApprovalDelaySeconds: 60, automaticAdvanceDelaySeconds: 30,
  automaticAnalystCapitalReserve: 500000000, limitIncreaseRequestIntervalSeconds: 86400,
  automaticLimitIncreaseApprovalDelaySeconds: 60, automaticTransferIntervalSeconds: 3600,
  automaticWithdrawalIntervalSeconds: 3600, treasuryDistributionIntervalSeconds: 3600,
  paymentInterval6Seconds: 300, paymentInterval12Seconds: 180,
  advancePaymentInterval6Seconds: 300, advancePaymentInterval12Seconds: 180,
  automaticCreditMinimumAmount: 100000, automaticCreditMaximumAmount: 100000000,
  automaticAdvanceMinimumAmount: 100000, automaticAdvanceMaximumAmount: 100000000,
  automaticAdvanceMode: 'credit_amount', automaticCreditTermMonths: 0
};
vm.createContext(context);
for (const file of ['src/js/23c-simulation-automation.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, { filename: file });
}
let available = context.automaticAnalystCapitalAvailable();
assert(available === 450000000, `La automatización debe restar reserva y crédito pendiente; disponible=${available}`);
availableCapital = 700000000;
const generated = context.generateAutomaticLimitIncreaseRequests(now);
assert(generated === 2, `Solo deben apartarse dos aumentos de $50 millones sobre el capital utilizable; generados=${generated}`);
assert(context.automaticAnalystCapitalAvailable() === 0, 'Los aumentos pendientes deben reservarse antes de aprobarse.');
availableCapital = 900000000;
assert(context.automaticAnalystCapitalAvailable() === 200000000, 'La disponibilidad automática nunca debe usar la reserva protegida ni el crédito pendiente.');
console.log('PASS: la automatización protege $500 millones y reserva crédito/aumentos pendientes antes de programar más desembolsos.');
