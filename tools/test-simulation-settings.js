#!/usr/bin/env node
// Regression: configurable simulation values and analyst capital save independently.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function assert(condition, message) { if (!condition) throw new Error(message); }
function element(value = '') {
  const listeners = {};
  return { value, textContent: '', dataset: {}, disabled: false, setAttribute() {}, focus() {}, contains() { return false; }, classList: { add() {}, remove() {}, toggle() {} }, addEventListener(type, fn) { listeners[type] = fn; }, listeners };
}
const controls = new Map();
const ensure = (id, value = '') => {
  if (!controls.has(id)) controls.set(id, element(value));
  return controls.get(id);
};
[
  ['simulationSettingsForm', ''], ['simulationMonthlyRateInput', '2'], ['simulationTreasuryRateInput', '1000'],
  ['simulationLimitIncreaseAmountInput', '50000000'], ['simulationAnalystCapitalInput', '2000000000'], ['simulationAnalystReserveInput', '500000000'],
  ['simulationCreditMinimumInput', '100000'], ['simulationCreditMaximumInput', '100000000'],
  ['simulationAdvanceMinimumInput', '100000'], ['simulationAdvanceMaximumInput', '100000000'],
  ['simulationAdvanceModeSelect', 'credit_amount'], ['simulationCreditTermSelect', '0'],
  ['simulationSettingsStatus', ''],
  ['simulationAnalystCapitalStatus', ''], ['saveAnalystCapitalButton', '']
].forEach(([id, value]) => ensure(id, value));
const intervalControls = [
  ['simulationCreditRequestIntervalInput', '3600', 'simulationCreditRequestIntervalUnit'],
  ['simulationCreditApprovalDelayInput', '60', 'simulationCreditApprovalDelayUnit'],
  ['simulationAdvanceDelayInput', '30', 'simulationAdvanceDelayUnit'],
  ['simulationLimitIncreaseRequestIntervalInput', '86400', 'simulationLimitIncreaseRequestIntervalUnit'],
  ['simulationLimitIncreaseApprovalDelayInput', '60', 'simulationLimitIncreaseApprovalDelayUnit'],
  ['simulationPayment6IntervalInput', '300', 'simulationPayment6IntervalUnit'],
  ['simulationPayment12IntervalInput', '180', 'simulationPayment12IntervalUnit'],
  ['simulationAdvancePayment6IntervalInput', '300', 'simulationAdvancePayment6IntervalUnit'],
  ['simulationAdvancePayment12IntervalInput', '180', 'simulationAdvancePayment12IntervalUnit'],
  ['simulationTreasuryDistributionIntervalInput', '3600', 'simulationTreasuryDistributionIntervalUnit'],
  ['simulationAutomaticTransferIntervalInput', '3600', 'simulationAutomaticTransferIntervalUnit'],
  ['simulationAutomaticWithdrawalIntervalInput', '3600', 'simulationAutomaticWithdrawalIntervalUnit']
];
intervalControls.forEach(([input, value, unit]) => { ensure(input, value); ensure(unit, 'seconds'); });
const db = {
  simulationSettings: { treasuryTimerRate: 1000 }, simulationAutomation: { paused: false }, withdrawalTreasury: { lastAccruedAt: 'old' },
  limitIncreaseRequests: [], creditApplications: [], loans: [
    { id: 'advance-loan', accountId: 1, status: 'Activo', outstandingPrincipal: 1000000, termMonths: 6, paymentScheduleType: 'advance' },
    { id: 'credit-loan', accountId: 1, status: 'Activo', outstandingPrincipal: 1000000, termMonths: 6, paymentScheduleType: 'credit' }
  ]
};
let accruedAtRate = null;
let savedCount = 0;
let auditDetails = null;
const context = {
  db, reviewerSession: true, document: { activeElement: null },
  $: (selector) => ensure(String(selector).replace(/^#/, '')),
  simulationSettingsFor: (database) => ({
    monthlyInterestRate: 0.02, analystCapital: 2000000000, limitIncreaseAmount: 50000000,
    treasuryTimerRate: 1000, treasuryTimerIncomeCap: Number.MAX_SAFE_INTEGER, automaticAnalystCapitalReserve: 500000000,
    creditRequestIntervalSeconds: 3600, automaticCreditApprovalDelaySeconds: 60, automaticAdvanceDelaySeconds: 30,
    limitIncreaseRequestIntervalSeconds: 86400, automaticLimitIncreaseApprovalDelaySeconds: 60,
    paymentInterval6Seconds: 300, paymentInterval12Seconds: 180, advancePaymentInterval6Seconds: 300, advancePaymentInterval12Seconds: 180, treasuryDistributionIntervalSeconds: 3600,
    automaticTransferIntervalSeconds: 3600, automaticWithdrawalIntervalSeconds: 3600,
    automaticCreditMinimumAmount: 100000, automaticCreditMaximumAmount: 100000000,
    automaticAdvanceMinimumAmount: 100000, automaticAdvanceMaximumAmount: 100000000,
    automaticAdvanceMode: 'credit_amount', automaticCreditTermMonths: 0, automaticLimitIncreaseApprovalEnabled: true,
    ...(database.simulationSettings || {})
  }),
  MIN_CREDIT_AMOUNT: 100000, MAX_CREDIT_AMOUNT: 100000000, VALID_CREDIT_TERMS: [6, 12],
  captureDatabaseRevision: () => 'revision', isDatabaseRevisionCurrent: (token) => token === 'revision',
  catchUpAutomaticEventsBeforeOperation: () => true,
  accrueWithdrawalTreasury(database) { accruedAtRate = database.simulationSettings.treasuryTimerRate; },
  automaticPaymentIntervalForTerm: (term, database = db, scheduleType = 'credit') => {
    const settings = database.simulationSettings || {};
    if (scheduleType === 'advance') return term === 6 ? (settings.advancePaymentInterval6Seconds || 300) : (settings.advancePaymentInterval12Seconds || 180);
    return term === 6 ? (settings.paymentInterval6Seconds || 300) : (settings.paymentInterval12Seconds || 180);
  },
  recordAuditEvent(action, options) { auditDetails = options.details || null; },
  saveDatabase() { savedCount += 1; return true; },
  renderReviewerDashboard() {}, renderFinancialAuditPanel() {}, renderMonthlyFinancialReport() {},
  money: (amount) => '$ ' + Math.round(Number(amount) || 0).toLocaleString('es-CO'),
  showToast() {}
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src/js/23b-simulation-settings.js'), 'utf8'), context, { filename: '23b-simulation-settings.js' });
context.renderSimulationSettingsPanel();
assert(ensure('simulationMonthlyRateInput').value === '2' && ensure('simulationTreasuryRateInput').value === '1000', 'El panel debe cargar tasa y ritmo guardados.');
assert(ensure('simulationAnalystCapitalInput').value === '2000000000', 'El capital base debe iniciar en $2.000 millones.');
assert(ensure('simulationAnalystReserveInput').value === '500000000', 'El panel protege $500 millones de capital para la automatización.');
ensure('simulationMonthlyRateInput').value = '1.75';
ensure('simulationTreasuryRateInput').value = '1500';
ensure('simulationLimitIncreaseAmountInput').value = '25000000';
ensure('simulationAnalystReserveInput').value = '500000000';
ensure('simulationAdvancePayment6IntervalUnit').value = 'seconds';
ensure('simulationAdvancePayment12IntervalUnit').value = 'seconds';
ensure('simulationAdvancePayment6IntervalInput').value = '45';
ensure('simulationAdvancePayment12IntervalInput').value = '90';
ensure('simulationSettingsForm').listeners.submit({ preventDefault() {} });
assert(accruedAtRate === 1000, 'El tiempo anterior al cambio debe liquidarse con la tarifa previa.');
assert(db.simulationSettings.monthlyInterestRate === 0.0175 && db.simulationSettings.treasuryTimerRate === 1500, 'El panel debe guardar tasa y ritmo nuevos.');
assert(db.simulationSettings.limitIncreaseAmount === 25000000, 'El panel debe guardar el nuevo saldo de cada aumento de cupo.');
assert(db.simulationSettings.automaticAnalystCapitalReserve === 500000000, 'El panel debe guardar la reserva protegida.');
assert(db.simulationSettings.advancePaymentInterval6Seconds === 45 && db.simulationSettings.advancePaymentInterval12Seconds === 90, 'El panel debe guardar los intervalos de cuotas de avances por separado.');
assert(db.simulationSettings.paymentInterval6Seconds === 300 && db.simulationSettings.paymentInterval12Seconds === 180, 'Configurar las cuotas de avances no debe cambiar los intervalos generales de créditos.');
assert(db.loans.find((loan) => loan.id === 'advance-loan').automaticPaymentIntervalSeconds === 45, 'Las deudas por avances deben adoptar su intervalo exclusivo.');
assert(db.loans.find((loan) => loan.id === 'credit-loan').automaticPaymentIntervalSeconds === 300, 'Las deudas de crédito deben conservar su intervalo general.');
assert(db.simulationSettings.treasuryTimerIncomeCap === Number.MAX_SAFE_INTEGER, 'Tesorería debe conservar la acumulación sin tope comercial.');
assert(savedCount === 1 && auditDetails.limitIncreaseAmount === 25000000, 'El guardado y la auditoría deben incluir el importe de aumento.');

ensure('simulationSettingsForm').dataset.dirty = 'false';
ensure('simulationSettingsForm').listeners.input({ target: { id: 'simulationAnalystCapitalInput' } });
assert(ensure('simulationSettingsForm').dataset.dirty === 'false', 'Editar el capital debe mantenerse independiente del formulario de automatización.');
ensure('simulationAnalystCapitalInput').value = '2100000000';
ensure('saveAnalystCapitalButton').listeners.click();
assert(db.simulationSettings.analystCapital === 2100000000 && savedCount === 2, 'El botón debe guardar el saldo base del analista por separado.');
assert(ensure('simulationAnalystCapitalStatus').textContent.includes('2.100.000.000'), 'El control debe confirmar el nuevo saldo base.');
console.log('PASS: configura tasa, cronómetro, aumento de cupo y valores sin tope de Tesorería.');
console.log('PASS: guarda el capital del analista con un control independiente.');
