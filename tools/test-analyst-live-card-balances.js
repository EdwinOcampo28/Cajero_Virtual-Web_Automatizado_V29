#!/usr/bin/env node
// Regression tests: analyst request cards must read live balances and display current limits.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName;
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.className = '';
    this.textContent = '';
    this.value = '';
    this.hidden = false;
  }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = [...items]; }
  setAttribute(name, value) { this.attributes[name] = value; }
}

function walk(node, result = []) {
  if (!node) return result;
  result.push(node);
  for (const child of node.children || []) walk(child, result);
  return result;
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const elements = new Map();
const reviewerApplicationsList = new FakeElement('div');
const reviewerLimitRequestsList = new FakeElement('div');
const reviewerFilter = { value: 'all' };
const db = {
  accounts: [null,
    { id: 1, name: 'Edwin Ocampo', accountNumber: '7184 3059 6247', balance: 250000, card: { limit: 100000000, funds: 3300000, recoveredFunds: 700000, debt: 0 } },
    { id: 2, name: 'Pedro Ocampo', accountNumber: '4927 8613 5704', balance: 900000, card: { limit: 100000000, funds: 0, recoveredFunds: 0, debt: 0 } },
    { id: 3, name: 'Reinel Ocampo', accountNumber: '8361 4925 7083', balance: 1200000, card: { limit: 100000000, funds: 0, recoveredFunds: 0, debt: 0 } }
  ],
  creditApplications: [
    { id: 'app-1', accountId: 1, applicantName: 'Edwin Ocampo', accountNumber: '7184 3059 6247', amount: 25000000, monthlyIncome: 2500000, termMonths: 12, monthlyRate: 0.02, monthlyPayment: 2400000, totalPayable: 28800000, purpose: 'Prueba', employment: 'Empleado', status: 'Desembolsado', date: '2026-10-21T10:00:00.000Z' },
    { id: 'limit-internal-1', accountId: 1, applicantName: 'Edwin Ocampo', accountNumber: '7184 3059 6247', amount: 50000000, activatedAmount: 0, cardFundsRemaining: 50000000, origin: 'Aumento de cupo', purpose: 'Desembolso automático por aumento de cupo', status: 'Aprobado', date: '2026-10-21T11:00:00.000Z' },
    { id: 'partial-app-1', accountId: 1, applicantName: 'Edwin Ocampo', accountNumber: '7184 3059 6247', amount: 10000000, activatedAmount: 3000000, cardFundsRemaining: 7000000, origin: 'Crédito', termMonths: 12, status: 'Aprobado', date: '2026-10-21T12:00:00.000Z', lastAdvancedAt: '2026-10-21T12:10:00.000Z' }
  ],
  limitIncreaseRequests: [{ id: 'limit-1', accountId: 1, applicantName: 'Edwin Ocampo', accountNumber: '7184 3059 6247', previousLimit: 100000000, requestedLimit: 150000000, increaseAmount: 50000000, status: 'Aprobado', date: '2026-10-21T10:00:00.000Z', disbursedAmount: 50000000 }],
  loans: [{ id: 'loan-1', accountId: 1, applicationId: 'app-1', applicationIds: ['app-1'], outstandingPrincipal: 18000000, originalDisbursedTotal: 25000000, principalOriginal: 25000000, status: 'Activo', monthlyPayment: 2400000, installmentsPaid: 2, termMonths: 12, payments: [], disbursedAt: '2026-10-21T10:00:00.000Z' }]
};
const ctx = {
  db,
  reviewerSession: true,
  reviewerApplicationsList,
  reviewerLimitRequestsList,
  reviewerFilter,
  document: { createElement: (tag) => new FakeElement(tag) },
  $: (selector) => {
    const key = String(selector).replace(/^#/, '');
    if (!elements.has(key)) elements.set(key, new FakeElement('div'));
    return elements.get(key);
  },
  getReviewerSelectedClientId: () => null,
  money: (amount) => '$ ' + Math.round(Number(amount) || 0).toLocaleString('en-US'),
  shortDateTime: () => '21 oct. 2026',
  statusClass: (status) => String(status).toLowerCase().replace(/\s+/g, '-'),
  ILLUSTRATIVE_MONTHLY_RATE: 0.02,
  currentMonthlyInterestRate: () => 0.02,
  formatMonthlyInterestRate: () => '2,00 %',
  REVIEWER_NAME: 'Analista de créditos',
  findLoanForApplication: (applicationId) => db.loans.find((loan) => loan.applicationId === applicationId || loan.applicationIds?.includes(applicationId)) || null,
  outstandingLoanPrincipalForAccount: (accountId) => Math.round(db.loans.filter((loan) => loan.accountId === accountId).reduce((sum, loan) => sum + Math.max(0, Number(loan.outstandingPrincipal) || 0), 0)),
  outstandingCreditExposureForAccount: (accountId) => Math.round(db.loans.filter((loan) => loan.accountId === accountId).reduce((sum, loan) => sum + Math.max(0, Number(loan.outstandingPrincipal) || 0), 0) + Math.max(0, Number(db.accounts[accountId]?.card?.debt) || 0)),
  totalDisbursedForAccount: (accountId) => Math.round(db.loans.filter((loan) => loan.accountId === accountId).reduce((sum, loan) => sum + Math.max(0, Number(loan.originalDisbursedTotal) || 0), 0)),
  availableAdvancesForCard: (card) => Math.max(0, Math.min(Number(card.limit) || 0, (Number(card.funds) || 0) + (Number(card.recoveredFunds) || 0))),
  cardCreditLimitForAccount: (accountId) => Number(db.accounts[accountId]?.card?.limit) || 0,
  roundMoney: (amount) => Math.round(Number(amount) || 0),
  createId: () => 'generated-id'
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src/js/05-analyst-dashboard-02.js'), 'utf8'), ctx, { filename: '05-analyst-dashboard-02.js' });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src/js/06-analyst-decisions-01.js'), 'utf8'), ctx, { filename: '06-analyst-decisions-01.js' });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src/js/23d-reviewer-automatic-advances.js'), 'utf8'), ctx, { filename: '23d-reviewer-automatic-advances.js' });

function allText(root) { return walk(root).map((node) => node.textContent || '').join(' | '); }
function liveValues(root) {
  return walk(root).filter((node) => node.className === 'reviewer-live-client-balance-cell').map((cell) => allText(cell));
}

ctx.renderReviewerApplications();
let values = liveValues(reviewerApplicationsList);
assert(values.some((value) => value.includes('$ 250,000')), 'Debe mostrar el saldo actual de ahorros del cliente.');
assert(values.some((value) => value.includes('$ 4,000,000')), 'Debe mostrar fondos actuales disponibles en tarjeta (fondos + capital recuperado).');
assert(values.some((value) => value.includes('$ 100,000,000')), 'Debe mostrar el cupo autorizado actual.');
assert(values.some((value) => value.includes('$ 18,000,000')), 'Debe mostrar la deuda pendiente actual, no un valor capturado al solicitar.');

// Simulate a payment/advance/cupo update arriving from another tab and repaint requests.
db.accounts[1].balance = 425000;
db.accounts[1].card.funds = 5000000;
db.accounts[1].card.recoveredFunds = 1100000;
db.accounts[1].card.limit = 150000000;
db.loans[0].outstandingPrincipal = 16000000;
ctx.renderReviewerApplications();
values = liveValues(reviewerApplicationsList);
assert(values.some((value) => value.includes('$ 425,000')), 'El resumen de solicitud debe refrescar ahorros sin recargar la página.');
assert(values.some((value) => value.includes('$ 6,100,000')), 'El resumen debe refrescar fondos de tarjeta en tiempo real.');
assert(values.some((value) => value.includes('$ 150,000,000')), 'El resumen debe refrescar cupo tras un aumento aprobado.');
assert(values.some((value) => value.includes('$ 16,000,000')), 'El resumen debe refrescar deuda pendiente tras un pago.');

ctx.renderReviewerLimitIncreaseRequests();
const limitText = allText(reviewerLimitRequestsList);
assert(limitText.includes('Cupo antes de la solicitud'), 'El aumento debe conservar el cupo anterior como dato histórico.');
assert(limitText.includes('Cupo actual de la tarjeta'), 'El aumento debe distinguir el cupo actual de la tarjeta.');
assert(limitText.includes('$ 150,000,000'), 'La tarjeta del analista debe presentar el cupo actualizado tras aprobar el aumento.');
assert(walk(reviewerApplicationsList).some((node) => node.className === 'reviewer-live-client-balance'), 'Las solicitudes de crédito deben incluir saldos en vivo.');
assert(walk(reviewerLimitRequestsList).some((node) => node.className === 'reviewer-live-client-balance'), 'Las solicitudes de aumento deben incluir saldos en vivo.');
assert(!allText(reviewerApplicationsList).includes('Desembolso automático por aumento de cupo'), 'Los fondos de aumento sin avances no deben aparecer en la lista de créditos del analista.');
assert(allText(reviewerApplicationsList).includes('Solicitud l-app-1'), 'La solicitud de crédito debe permanecer en su bandeja aunque ya tenga un avance parcial.');
assert(!allText(reviewerApplicationsList).includes('Avance parcial') && !allText(reviewerApplicationsList).includes('Crédito activado por avances'), 'Los movimientos de avance deben mostrarse únicamente en su sección aparte.');
db.auditLog = [{ action: 'Crédito activado por avance', category: 'creditos', accountId: 1, accountName: 'Edwin Ocampo', amount: 3000000, date: '2026-10-21T12:10:00.000Z', referenceId: 'partial-app-1', details: { loanId: 'loan-partial', termMonths: 12 } }];
db.accounts[1].card.pendingDisbursements = [{ applicationId: 'partial-app-1', remainingAmount: 7000000 }];
db.simulationAutomation = { paused: false };
ctx.reviewerSession = true;
ctx.renderReviewerAutomaticAdvances();
const advanceHistory = elements.get('reviewerAutomaticAdvancesHistory');
assert(allText(advanceHistory).includes('$ 3,000,000'), 'El avance parcial debe aparecer como operación en la sesión de avances.');
assert(allText(advanceHistory).includes('12 cuotas'), 'El historial del avance debe mostrar su plazo.');
const advancePending = elements.get('reviewerAutomaticAdvancesList');
assert(allText(advancePending).includes('$ 7,000,000'), 'El saldo parcial restante debe quedar visible en la cola de avances.');

const gridCss = fs.readFileSync(path.join(__dirname, '..', 'css/modules/05-analyst-panel-01.css'), 'utf8');
assert(/\.reviewer-applications-list\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s.test(gridCss), 'Las solicitudes deben mostrarse en dos columnas en escritorio.');

console.log('PASS: el analista ve saldos dinámicos de ahorros, fondos de tarjeta, cupo y deuda en las dos clases de solicitud.');
console.log('PASS: tras cambiar saldo/cupo/deuda en la base, el siguiente render refleja los valores nuevos.');
console.log('PASS: solicitudes se organizan en dos columnas en escritorio.');
