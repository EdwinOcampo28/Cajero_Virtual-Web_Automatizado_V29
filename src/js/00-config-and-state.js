  const STORAGE_KEY = 'cajero_virtual_savings_v15_clean';
  const LEGACY_STORAGE_KEY = 'cajero_virtual_savings_v1';
  const SIMULATION_CONFIG_STORAGE_KEY = 'cajero_virtual_simulation_config_v1';
  const MAX_WITHDRAWAL_AMOUNT = 20000000;
  const MAX_DEPOSIT_AMOUNT = 20000000;
  const MAX_TRANSFER_AMOUNT = 20000000;
  const MAX_ACCOUNT_BALANCE = Number.MAX_SAFE_INTEGER;
  const MAX_CARD_FUNDS = 100000000;
  const ADVANCE_FEE = 100000;
  const DEPOSIT_FEE = 20000;
  const OPERATION_FEE = 50000;
  const MAX_CARD_LIMIT = Number.MAX_SAFE_INTEGER;
  const ANALYST_TOTAL_CAPITAL = 2000000000;
  const MIN_CREDIT_AMOUNT = 100000;
  const MAX_CREDIT_AMOUNT = 100000000;
  const DEFAULT_LIMIT_INCREASE_AMOUNT = 50000000;
  const ILLUSTRATIVE_MONTHLY_RATE = 0.02;
  const REVIEWER_PIN = '482917';
  const REVIEWER_NAME = 'Analista de créditos';
  const TREASURY_PIN = '3456';
  const TREASURY_NAME = 'Tesorería de retiros';
  const TREASURY_TIMER_RATE = 1000;
  const TREASURY_TIMER_INCOME_CAP = Number.MAX_SAFE_INTEGER;
  const TREASURY_DISTRIBUTION_FEE = DEPOSIT_FEE;
  const TREASURY_ACCOUNT_NUMBER = '6024 1937 0004';
  const MAX_AUDIT_EVENTS = 2000;
  const MAX_ACCOUNT_HISTORY_ITEMS = 500;
  const MAX_CARD_HISTORY_ITEMS = 500;
  const MAX_TREASURY_HISTORY_ITEMS = 2000;
  const MAX_CREDIT_APPLICATIONS = 500;
  const MAX_LIMIT_INCREASE_REQUESTS = 500;
  const MAX_CLOSED_LOANS = 200;
  const VALID_CREDIT_TERMS = [6, 12, 18, 24, 30, 36, 42, 48, 54, 60];
  const VALID_CARD_ADVANCE_TERMS = [6, 12, 18, 24, 30, 36, 42, 48, 54, 60];
  const SIMULATION_HOUR_MS = 60 * 60 * 1000;
  const SIMULATION_APPROVAL_DELAY_MS = 60 * 1000;
  const AUTOMATIC_PAYMENT_INTERVAL_MS = { 6: 5 * 60 * 1000, 12: 3 * 60 * 1000 };
  const QUICK_WITHDRAW_AMOUNTS = [50000, 100000, 200000, 500000, 1000000, 3000000, 5000000, 7500000, 10000000, 15000000, 20000000];
  const QUICK_DEPOSIT_AMOUNTS = [100000, 250000, 500000, 1000000, 2000000, 3000000, 5000000, 7500000, 10000000, 15000000, 20000000];
  const QUICK_TRANSFER_AMOUNTS = [100000, 500000, 1000000, 5000000, 10000000, 15000000, 20000000];
  const ACCOUNT_SEED = [
    null,
    { id: 1, name: 'Edwin Ocampo', accountNumber: '7184 3059 6247', cardNumber: '5412 8043 1000 1045', accountType: 'Cuenta de ahorros', pin: '5837', balance: 0, withdrawnToday: 0, withdrawalDate: '', history: [] },
    { id: 2, name: 'Pedro Ocampo', accountNumber: '4927 8613 5704', cardNumber: '5412 8043 1000 5704', accountType: 'Cuenta de ahorros', pin: '9146', balance: 0, withdrawnToday: 0, withdrawalDate: '', history: [] },
    { id: 3, name: 'Reinel Ocampo', accountNumber: '8361 4925 7083', cardNumber: '5412 8043 1000 7083', accountType: 'Cuenta de ahorros', pin: '7269', balance: 0, withdrawnToday: 0, withdrawalDate: '', history: [] }
  ];
  const MAX_ACCOUNT_ID = ACCOUNT_SEED.length - 1;
  function maxSavingsBalanceForAccount() {
    return MAX_ACCOUNT_BALANCE;
  }

  const $ = (selector) => document.querySelector(selector);
  const loginView = $('#loginView');
  const appView = $('#appView');
  const reviewerLoginView = $('#reviewerLoginView');
  const reviewerView = $('#reviewerView');
  const treasuryLoginView = $('#treasuryLoginView');
  const treasuryView = $('#treasuryView');
  const treasuryAccessButton = $('#treasuryAccessButton');
  const treasuryLoginForm = $('#treasuryLoginForm');
  const treasuryPinInput = $('#treasuryPinInput');
  const treasuryLoginError = $('#treasuryLoginError');
  const reviewerAccessButton = $('#reviewerAccessButton');
  const reviewerLoginForm = $('#reviewerLoginForm');
  const reviewerPinInput = $('#reviewerPinInput');
  const reviewerLoginError = $('#reviewerLoginError');
  const reviewerFilter = $('#reviewerFilter');
  const reviewerApplicationsList = $('#reviewerApplicationsList');
  const reviewerLimitRequestsList = $('#reviewerLimitRequestsList');
  const loginForm = $('#loginForm');
  const accountSelect = $('#accountSelect');
  const pinInput = $('#pinInput');
  const loginError = $('#loginError');
  const togglePin = $('#togglePin');
  const modalOverlay = $('#modalOverlay');
  const appDialogOverlay = $('#appDialogOverlay');
  const appDialogCard = $('#appDialogCard');
  let appDialogResolver = null;
  let appDialogType = 'confirm';
  let appDialogPreviousFocus = null;
  const operationForm = $('#operationForm');
  const operationError = $('#operationError');
  const amountInput = $('#amountInput');
  const destinationSelect = $('#destinationSelect');
  const destinationField = $('#destinationField');
  const historyFilter = $('#historyFilter');
  const creditForm = $('#creditForm');
  const cardLimitRequestForm = $('#cardLimitRequestForm');
  const creditAmountInput = $('#creditAmountInput');
  const creditTermSelect = $('#creditTermSelect');
  const advanceTermSelect = $('#advanceTermSelect');
  const creditIncomeInput = $('#creditIncomeInput');
  const creditPurposeSelect = $('#creditPurposeSelect');
  const creditEmploymentSelect = $('#creditEmploymentSelect');
  const creditError = $('#creditError');
  const sidebar = $('#sidebar');
  // La base se inicializa al final, cuando todos los módulos de lógica ya están cargados.
  // No se elimina ningún dato al abrir la aplicación; el borrado exige confirmación expresa.
  let db = null;
  // Control optimista de concurrencia entre pestañas: impide sobrescribir cambios recientes.
  let dbRevision = 0;
  let lastPersistedRaw = null;
  let databaseLoadIssue = false;
  let activeAccountId = null;
  let reviewerSession = false;
  let treasurySession = false;
  let currentModalAction = null;
  let currentView = 'overview';
  let toastTimer = null;
  let previousFocusedElement = null;

